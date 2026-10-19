#!/usr/bin/env python3
"""Time reportingrest's count-shaped calls against the Cohort Builder's own path, on a dev server.

Step 1 of docs/briefs/2026-10-18-cohort-counts.md. Standard library only. Credentials come from the
environment (OPENMRS_BASE, OPENMRS_USER, OPENMRS_PASS); nothing is written to the server.

For each query it times:
  ref         GET  reportingrest/cohort/<builtIn key>?v=ref&<params>   (single criterion; count only)
  ref-post    POST reportingrest/cohort/<builtIn key>?v=ref  {params}   (single criterion; list params in the body)
  rowFilters  POST reportingrest/adhocquery?v=rowFilters                (composition evaluated, ids returned, no columns)
  full        POST reportingrest/adhocquery?v=full                      (what the Cohort Builder does today)

The first call of each (query, method) pair in the run is reported separately as "first"; the rest
are the warm sample. Raw per-call timings go to the JSON file named by --out.
"""
import argparse
import base64
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

PDSD = 'org.openmrs.module.reporting.dataset.definition.PatientDataSetDefinition'
PDD = 'org.openmrs.module.reporting.data.patient.definition.PatientDataDefinition'
COHORT_PREFIX = 'reporting.library.cohortDefinition.builtIn.'
COLUMNS = [
    {'name': 'firstname', 'key': 'reporting.library.patientDataDefinition.builtIn.preferredName.givenName', 'type': PDD},
    {'name': 'lastname', 'key': 'reporting.library.patientDataDefinition.builtIn.preferredName.familyName', 'type': PDD},
    {'name': 'gender', 'key': 'reporting.library.patientDataDefinition.builtIn.gender', 'type': PDD},
    {'name': 'age', 'key': 'reporting.library.patientDataDefinition.builtIn.ageOnDate.fullYears', 'type': PDD},
    {'name': 'patientId', 'key': 'reporting.library.patientDataDefinition.builtIn.patientId', 'type': PDD},
]


def criteria(today, hiv_program, encounter_type):
    """Each query: a list of (builtIn key, parameterValues). One entry = single criterion."""
    return [
        ('under 30', [('upToAgeOnDate', {'effectiveDate': today, 'maxAge': 29})]),
        ('40 and over', [('atLeastAgeOnDate', {'effectiveDate': today, 'minAge': 40})]),
        ('aged 15-49', [('ageRangeOnDate', {'effectiveDate': today, 'minAge': 15, 'maxAge': 49})]),
        ('female', [('females', {})]),
        ('enrolled in program', [('patientsWithEnrollment', {'programs': [hiv_program]})]),
        # encounterSearchAdvanced is the key the builder's Encounters form emits; the ref path needs all eight parameters.
        ('had encounter (encounterSearchAdvanced)', [('encounterSearchAdvanced', {'encounterTypeList': [encounter_type]})]),
        ('had encounter (anyEncounterOfTypesDuringPeriod)', [('anyEncounterOfTypesDuringPeriod', {'encounterTypes': [encounter_type], 'startDate': '2000-01-01', 'endDate': today})]),
        ('women aged 15-49', [('females', {}), ('ageRangeOnDate', {'effectiveDate': today, 'minAge': 15, 'maxAge': 49})]),
        ('in program, under 30', [('patientsWithEnrollment', {'programs': [hiv_program]}), ('upToAgeOnDate', {'effectiveDate': today, 'maxAge': 29})]),
    ]


class Client:
    def __init__(self, base, user, password):
        self.base = base.rstrip('/') + '/ws/rest/v1/reportingrest/'
        token = base64.b64encode(f'{user}:{password}'.encode()).decode()
        # Cloudflare in front of the dev server rejects Python's default User-Agent (error 1010).
        self.headers = {'Authorization': f'Basic {token}', 'Accept': 'application/json', 'User-Agent': 'omnibar-cohort-count-bench/1'}

    def call(self, method, path, body=None):
        data = None
        headers = dict(self.headers)
        if body is not None:
            data = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                raw = resp.read()
                status = resp.status
        except urllib.error.HTTPError as e:
            raw = e.read()
            status = e.code
        elapsed = time.perf_counter() - t0
        return status, raw, elapsed


def ref_get(client, key, params):
    qs = [('v', 'ref')]
    for name, value in params.items():
        if isinstance(value, list):
            qs.extend((name, v) for v in value)
        else:
            qs.append((name, value))
    return client.call('GET', f'cohort/{COHORT_PREFIX}{key}?' + urllib.parse.urlencode(qs))


def ref_post(client, key, params):
    return client.call('POST', f'cohort/{COHORT_PREFIX}{key}?v=ref', params)


def adhoc(client, crits, rep):
    body = {
        'type': PDSD,
        'columns': COLUMNS if rep == 'full' else [],
        'rowFilters': [
            {'type': PDSD, 'key': COHORT_PREFIX + key, **({'parameterValues': params} if params else {})}
            for key, params in crits
        ],
        'customRowFilterCombination': ' AND '.join(str(i + 1) for i in range(len(crits))),
    }
    return client.call('POST', f'adhocquery?v={rep}', body)


def count_from(method, raw):
    try:
        d = json.loads(raw)
    except ValueError:
        return None
    if 'error' in d:
        return 'error: ' + str(d['error'].get('message', ''))[:80]
    if method in ('ref', 'ref-post'):
        return d.get('count')
    if method == 'rowFilters':
        return d.get('result', {}).get('size')
    if method == 'full':
        return len(d.get('rows', []))
    return None


def pct(values, p):
    if not values:
        return None
    values = sorted(values)
    k = (len(values) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (k - lo)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--runs', type=int, default=int(os.environ.get('BENCH_RUNS', '7')), help='calls per (query, method), including the first')
    ap.add_argument('--pause', type=float, default=float(os.environ.get('BENCH_PAUSE', '0.5')), help='seconds between calls')
    ap.add_argument('--hiv-program', default=os.environ.get('BENCH_HIV_PROGRAM', ''), help='program uuid (one with enrollments on the server)')
    ap.add_argument('--encounter-type', default=os.environ.get('BENCH_ENCOUNTER_TYPE', ''), help='encounter type uuid')
    ap.add_argument('--out', default='cohort-count-bench.json')
    ap.add_argument('--skip-full', action='store_true', help='skip the v=full calls')
    ap.add_argument('--full-runs', type=int, default=None, help='calls for v=full (default: --runs)')
    ap.add_argument('--only', default='', help='comma-separated substrings; run only queries whose label contains one')
    args = ap.parse_args()

    base = os.environ.get('OPENMRS_BASE', 'https://o3.pgb.md/openmrs')
    user, password = os.environ.get('OPENMRS_USER'), os.environ.get('OPENMRS_PASS')
    if not (user and password and args.hiv_program and args.encounter_type):
        sys.exit('need OPENMRS_USER, OPENMRS_PASS, --hiv-program and --encounter-type')
    client = Client(base, user, password)
    today = date.today().isoformat()

    results = []
    wanted = [w.strip().lower() for w in args.only.split(',') if w.strip()]
    for label, crits in criteria(today, args.hiv_program, args.encounter_type):
        if wanted and not any(w in label.lower() for w in wanted):
            continue
        methods = []
        if len(crits) == 1:
            key, params = crits[0]
            methods.append(('ref', lambda: ref_get(client, key, params)))
            if any(isinstance(v, list) for v in params.values()):
                methods.append(('ref-post', lambda: ref_post(client, key, params)))
        methods.append(('rowFilters', lambda: adhoc(client, crits, 'rowFilters')))
        if not args.skip_full:
            methods.append(('full', lambda: adhoc(client, crits, 'full')))
        for method, fn in methods:
            calls = []
            runs = args.full_runs if (method == 'full' and args.full_runs is not None) else args.runs
            for i in range(runs):
                status, raw, elapsed = fn()
                calls.append({'i': i, 'status': status, 'seconds': round(elapsed, 4), 'bytes': len(raw), 'count': count_from(method, raw)})
                print(f'{label:32} {method:11} #{i} {status} {elapsed:7.3f}s {len(raw):>9} B  count={calls[-1]["count"]}', file=sys.stderr, flush=True)
                time.sleep(args.pause)
            results.append({'query': label, 'criteria': crits, 'method': method, 'calls': calls})

    with open(args.out, 'w') as f:
        json.dump({'base': base, 'date': today, 'runs': args.runs, 'results': results}, f, indent=1)

    print('| Query | Method | Count | First | Warm p50 | Warm p95 | Bytes |')
    print('| --- | --- | --- | --- | --- | --- | --- |')
    for r in results:
        ok = [c for c in r['calls'] if c['status'] in (200, 201)]
        warm = [c['seconds'] for c in ok[1:]]
        first = ok[0]['seconds'] if ok else None
        count = ok[-1]['count'] if ok else r['calls'][-1]['count']
        fmt = lambda s: f'{s:.2f} s' if s is not None else '-'
        print(f"| {r['query']} | {r['method']} | {count} | {fmt(first)} | {fmt(pct(warm, 0.5))} | {fmt(pct(warm, 0.95))} | {ok[-1]['bytes'] if ok else '-'} |")


if __name__ == '__main__':
    main()
