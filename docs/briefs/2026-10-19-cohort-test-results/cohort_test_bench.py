#!/usr/bin/env python3
"""Time counts by numeric test results, and the concept lookups behind them, on a dev server.

Step 6 of docs/briefs/2026-10-19-cohort-test-results.md, in the style of the cohort counts benchmark
(docs/briefs/2026-10-18-cohort-counts/cohort_count_bench.py). Standard library only. Credentials come
from the environment (OPENMRS_BASE, OPENMRS_USER, OPENMRS_PASS); nothing is written to the server.

For each query it times:
  rowFilters  POST reportingrest/adhocquery?v=rowFilters   (what the count row sends)
  full        POST reportingrest/adhocquery?v=full         (what the Cohort Builder sends on Enter)
and, for the names typed while asking, the count row's concept lookup:
  lookup      GET  concept?q=<words>&v=custom:(uuid,display,units,datatype:(hl7Abbreviation),names:(name,locale))

numericObsSearchAdvanced declares eight required parameters, so the count-only GET can't be used.
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
from datetime import date, timedelta

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
LOOKUP_REP = 'custom:(uuid,display,units,datatype:(hl7Abbreviation),names:(name,locale))'


def numeric(concept, which, operator, value, on_or_after=None):
    params = {'timeModifier': which, 'question': concept, 'operator1': operator, 'value1': str(value)}
    if on_or_after:
        params['onOrAfter'] = on_or_after
    return ('numericObsSearchAdvanced', params)


def queries(viral_load, cd4, weight, year_ago):
    """Each query: a label, its row filters and their combination, as the count row composes them."""
    alive = ('diedDuringPeriod', {'endDate': date.today().isoformat()})
    return [
        ('latest viral load > 1000', [numeric(viral_load, 'LAST', 'GREATER_THAN', 1000)], '1'),
        ('any viral load > 1000', [numeric(viral_load, 'ANY', 'GREATER_THAN', 1000)], '1'),
        ('latest viral load > 1000, last 12 months', [numeric(viral_load, 'LAST', 'GREATER_THAN', 1000, year_ago)], '1'),
        ('latest CD4 < 200', [numeric(cd4, 'LAST', 'LESS_THAN', 200)], '1'),
        ('lowest CD4 < 200', [numeric(cd4, 'MIN', 'LESS_THAN', 200)], '1'),
        ('latest weight > 70', [numeric(weight, 'LAST', 'GREATER_THAN', 70)], '1'),
        ('any weight > 70', [numeric(weight, 'ANY', 'GREATER_THAN', 70)], '1'),
        ('highest weight > 100', [numeric(weight, 'MAX', 'GREATER_THAN', 100)], '1'),
        ('women with latest weight > 70', [('females', {}), alive, numeric(weight, 'LAST', 'GREATER_THAN', 70)], '(1 AND NOT 2) AND (3)'),
    ]


class Client:
    def __init__(self, base, user, password):
        self.base = base.rstrip('/') + '/ws/rest/v1/'
        token = base64.b64encode(f'{user}:{password}'.encode()).decode()
        # Cloudflare in front of the dev server rejects Python's default User-Agent (error 1010).
        self.headers = {'Authorization': f'Basic {token}', 'Accept': 'application/json', 'User-Agent': 'omnibar-cohort-test-bench/1'}

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
        return status, raw, time.perf_counter() - t0


def adhoc(client, filters, combination, rep):
    body = {
        'type': PDSD,
        'columns': COLUMNS if rep == 'full' else [],
        'rowFilters': [{'type': PDSD, 'key': COHORT_PREFIX + key, 'parameterValues': params} for key, params in filters],
        'customRowFilterCombination': combination,
    }
    return client.call('POST', f'reportingrest/adhocquery?v={rep}', body)


def lookup(client, words):
    return client.call('GET', 'concept?' + urllib.parse.urlencode({'q': words, 'v': LOOKUP_REP, 'limit': '20'}))


def count_from(method, raw):
    try:
        d = json.loads(raw)
    except ValueError:
        return None
    if 'error' in d:
        return 'error: ' + str(d['error'].get('message', ''))[:80]
    if method == 'rowFilters':
        return d.get('result', {}).get('size')
    if method == 'full':
        return len(d.get('rows', []))
    if method == 'lookup':
        return sum(1 for c in d.get('results', []) if (c.get('datatype') or {}).get('hl7Abbreviation') == 'NM')
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
    ap.add_argument('--runs', type=int, default=7, help='calls per (query, method), including the first')
    ap.add_argument('--full-runs', type=int, default=3, help='calls for v=full')
    ap.add_argument('--pause', type=float, default=0.5, help='seconds between calls')
    ap.add_argument('--viral-load', default='856AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', help='CIEL 856, HIV viral load')
    ap.add_argument('--cd4', default='5497AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', help='CIEL 5497, CD4 count')
    ap.add_argument('--weight', default='5089AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', help='CIEL 5089, weight (kg)')
    ap.add_argument('--out', default='cohort-test-bench.json')
    args = ap.parse_args()

    base = os.environ.get('OPENMRS_BASE', 'https://o3.pgb.md/openmrs')
    user, password = os.environ.get('OPENMRS_USER'), os.environ.get('OPENMRS_PASS')
    if not (user and password):
        sys.exit('need OPENMRS_USER and OPENMRS_PASS')
    client = Client(base, user, password)
    year_ago = (date.today() - timedelta(days=365)).isoformat()

    results = []

    def run(label, method, fn, runs):
        calls = []
        for i in range(runs):
            status, raw, elapsed = fn()
            calls.append({'i': i, 'status': status, 'seconds': round(elapsed, 4), 'bytes': len(raw), 'count': count_from(method, raw)})
            print(f'{label:42} {method:10} #{i} {status} {elapsed:7.3f}s {len(raw):>9} B  count={calls[-1]["count"]}', file=sys.stderr, flush=True)
            time.sleep(args.pause)
        results.append({'query': label, 'method': method, 'calls': calls})

    for words in ['viral load', 'vir', 'cd4', 'cd4 count', 'weight']:
        run(f'lookup "{words}"', 'lookup', lambda: lookup(client, words), args.runs)
    for label, filters, combination in queries(args.viral_load, args.cd4, args.weight, year_ago):
        run(label, 'rowFilters', lambda: adhoc(client, filters, combination, 'rowFilters'), args.runs)
        run(label, 'full', lambda: adhoc(client, filters, combination, 'full'), args.full_runs)

    with open(args.out, 'w') as f:
        json.dump({'base': base, 'date': date.today().isoformat(), 'runs': args.runs, 'results': results}, f, indent=1)

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
