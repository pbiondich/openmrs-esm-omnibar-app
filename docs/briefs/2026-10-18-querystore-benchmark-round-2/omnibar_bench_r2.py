#!/usr/bin/env python3
"""
Omnibar chart-lookup benchmark, round 2: the REST/FHIR path vs the query store's omnibar endpoint.

For each (patient, query) pair it times round 1's REST path and three variants of the request the
omnibar's query store provider sends, interleaved REST, A, B, C on every run:

  rest  - esm-omnibar-app's chart-lookup provider, exactly as round 1:
          GET /ws/rest/v1/concept?q=...   then
          GET /ws/fhir2/R4/Observation?subject:Patient=...&code=...&_sort=-date&_count=50
  A     - GET /ws/rest/v1/querystore/patient/{uuid}/search?q=...&mode=keyword&collapse=concept&limit=5&wait=false
          (what querystore-chart.provider.tsx sends today)
  B     - the same with mode=hybrid
  C     - the same as A plus types=obs (the dropdown only shows values)

Per variant it checks latest-value correctness (each group's latest against FHIR's latest obs of
that concept), first-row agreement with the REST dropdown, and which concept comes first for "cd4".

--throughput times a cold projection for the listed patients. The REST surface has no way to clear
one chart without re-projecting it in the same call (see DONE.md), so a chart that is already indexed
is timed through POST /querystore/reindex, which deletes and re-projects it synchronously, while
GET .../status is polled every 250 ms. A chart that is genuinely not indexed is timed through
POST .../warm and the same polling. Each touched chart is left indexed. Nothing writes clinical data.

Standard library only. Credentials come from the environment, never the command line:

  export OPENMRS_BASE=https://o3.pgb.md/openmrs
  export OPENMRS_USER=...
  export OPENMRS_PASS=...
  python3 omnibar_bench_r2.py --patients patients.txt --runs 10 --out r2-results
  python3 omnibar_bench_r2.py --patients patients.txt --throughput --throughput-patients small-2,large-1

patients.txt holds one patient UUID per line, optionally followed by a label:
  8673ee4f-e2ab-4077-ba55-4980f408773e  large-1
  1e2b7c3a-...                           small-2
"""

import argparse
import base64
import csv
import datetime
import http.cookiejar
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_QUERIES = ["cd4", "hb", "weight", "creatinine", "viral load", "temperature"]
NON_VALUE_DATATYPES = {"N/A", "Complex", "Rule", "Structured Numeric"}
CONCEPT_REP = "custom:(uuid,display,datatype:(display))"
QS = "/ws/rest/v1/querystore"
# The provider's URLSearchParams order: q, mode, collapse, limit, wait. Variant C adds types.
VARIANTS = {
    "A": {"mode": "keyword"},
    "B": {"mode": "hybrid"},
    "C": {"mode": "keyword", "types": "obs"},
}
CLASSES = ("correct", "tie", "older", "other")
CLASS_LABELS = {"correct": "correct", "tie": "same-date tie", "older": "older", "other": "other"}
POLL_SECONDS = 0.25


class Client:
    """Session-cookie client, so every path pays the same (cookie) auth cost per request."""

    def __init__(self, base, user, password, timeout):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        status, body, _, _ = self.get("/ws/rest/v1/session", headers={"Authorization": f"Basic {token}"})
        if status != 200 or not json.loads(body).get("authenticated"):
            sys.exit(f"Login failed (HTTP {status}). Check OPENMRS_BASE, OPENMRS_USER, OPENMRS_PASS.")

    def request(self, method, path, params=None, headers=None, data=None, timeout=None):
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params, safe=":,")
        req = urllib.request.Request(url, method=method, headers={"Accept": "application/json", "User-Agent": "omnibar-bench/1.0 (querystore benchmark)", **(headers or {})})
        if data is not None:
            req.data = json.dumps(data).encode()
            req.add_header("Content-Type", "application/json")
        start = time.perf_counter()
        try:
            with self.opener.open(req, timeout=timeout or self.timeout) as resp:
                body = resp.read()
                elapsed = (time.perf_counter() - start) * 1000
                return resp.status, body, elapsed, dict(resp.headers)
        except urllib.error.HTTPError as err:
            elapsed = (time.perf_counter() - start) * 1000
            return err.code, err.read(), elapsed, dict(err.headers)

    def get(self, path, params=None, headers=None):
        return self.request("GET", path, params=params, headers=headers)

    def post(self, path, data=None, timeout=None):
        return self.request("POST", path, data=data, timeout=timeout)


def rest_path(client, patient, query):
    """Round 1's path, unchanged. Returns timings, the latest obs per concept, and the dropdown's top answer."""
    status1, body1, ms1, _ = client.get("/ws/rest/v1/concept", {"q": query, "v": CONCEPT_REP, "limit": "10"})
    if status1 != 200:
        raise RuntimeError(f"concept search HTTP {status1}: {body1[:200]!r}")
    concepts = [
        c for c in json.loads(body1).get("results", [])
        if (c.get("datatype") or {}).get("display") not in NON_VALUE_DATATYPES
    ][:5]
    if not concepts:
        return {"ms": ms1, "concept_ms": ms1, "obs_ms": 0.0, "concepts": 0, "latest": {}, "top": None, "obs_by_concept": {}}

    params = {
        "subject:Patient": patient,
        "code": ",".join(c["uuid"] for c in concepts),
        "_sort": "-date",
        "_count": "50",
    }
    status2, body2, ms2, _ = client.get("/ws/fhir2/R4/Observation", params)
    if status2 != 200:
        raise RuntimeError(f"FHIR Observation HTTP {status2}: {body2[:200]!r}")

    latest, obs_by_concept = {}, {}
    concept_ids = {c["uuid"] for c in concepts}
    for entry in json.loads(body2).get("entry", []):
        resource = entry.get("resource", {})
        for coding in (resource.get("code") or {}).get("coding", []):
            code = coding.get("code")
            if code in concept_ids and not coding.get("system"):
                obs_by_concept.setdefault(code, []).append(resource.get("id"))
                latest.setdefault(code, (resource.get("id"), resource.get("effectiveDateTime")))
    # What the dropdown would show first: the latest obs of the first matching concept with data.
    top = next(((c["uuid"], c["display"], *latest[c["uuid"]]) for c in concepts if c["uuid"] in latest), None)
    return {
        "ms": ms1 + ms2,
        "concept_ms": ms1,
        "obs_ms": ms2,
        "concepts": len(concepts),
        "latest": latest,
        "top": top,
        "obs_by_concept": obs_by_concept,
    }


def header(headers, name):
    return next((v for k, v in headers.items() if k.lower() == name.lower()), None)


def server_millis(headers):
    """The server's own timing, if it sends one: the benchmark endpoint's X-Querystore-Millis, or a
    Server-Timing dur. The patient search endpoint sets neither at e75bd0b."""
    millis = header(headers, "X-Querystore-Millis")
    if millis:
        return float(millis)
    timing = header(headers, "Server-Timing")
    match = re.search(r"dur=([0-9.]+)", timing or "")
    return float(match.group(1)) if match else None


def qs_path(client, patient, query, variant):
    """One variant of the provider's request. Returns timing, the response status field and the groups."""
    params = {"q": query, "mode": VARIANTS[variant]["mode"], "collapse": "concept", "limit": "5", "wait": "false"}
    if "types" in VARIANTS[variant]:
        params["types"] = VARIANTS[variant]["types"]
    status, body, ms, headers = client.get(f"{QS}/patient/{urllib.parse.quote(patient)}/search", params)
    if status != 200:
        print(f"    {variant}: HTTP {status}: {body[:200]!r}")
        return {"ms": ms, "http": status, "status": f"HTTP {status}", "groups": [], "server_ms": server_millis(headers)}
    result = json.loads(body)
    return {"ms": ms, "http": status, "status": result.get("status"), "groups": result.get("groups") or [],
            "server_ms": server_millis(headers)}


def utc_day(value):
    """A FHIR effectiveDateTime or a query store `YYYY-MM-DD` as a calendar day. The query store dates
    obs by obsDatetime in UTC (DateFormatUtil.toLocalDate), so an offset-bearing FHIR time is moved to
    UTC first; otherwise an evening reading west of Greenwich would look a day apart."""
    if not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(datetime.timezone.utc)
    return parsed.date()


def compare_latest(rest, groups):
    """For every group whose concept the REST path also found: does its latest match FHIR's latest?"""
    out = []
    for group in groups:
        concept = group.get("conceptUuid")
        if concept not in rest["latest"]:
            continue
        latest = group.get("latest") or {}
        rest_uuid, rest_date = rest["latest"][concept]
        qs_day, rest_day = utc_day(latest.get("date")), utc_day(rest_date)
        if latest.get("resourceUuid") == rest_uuid:
            cls = "correct"
        elif qs_day is None or rest_day is None:
            cls = "other"
        elif qs_day == rest_day:
            cls = "tie"
        elif qs_day < rest_day:
            cls = "older"
        else:
            cls = "other"
        out.append({"concept": group.get("conceptName") or "", "class": cls, "qs_type": latest.get("resourceType"),
                    "qs_uuid": latest.get("resourceUuid"), "qs_day": qs_day, "rest_uuid": rest_uuid, "rest_day": rest_day})
    return out


def has_value(group):
    """Whether a row would show a value: an obs with a valueNumeric, or a snippet with something after
    the concept's label ("HIV status: Positive"). An order or an encounter has none."""
    latest = group.get("latest") or {}
    if latest.get("resourceType") != "obs":
        return False
    if latest.get("valueNumeric") is not None:
        return True
    snippet = (latest.get("snippet") or "").strip()
    name = (group.get("conceptName") or latest.get("conceptName") or "").strip()
    if name and snippet.startswith(name + ":"):
        return bool(snippet[len(name) + 1:].strip())
    return bool(snippet) and snippet != name


def first_row(rest, groups):
    """(agrees, no_value, name) for the first group. agrees is None when REST has no data to agree with."""
    first = groups[0] if groups else None
    agrees = None if not rest["top"] else bool(first) and first.get("conceptUuid") == rest["top"][0]
    no_value = None if not first else not has_value(first)
    name = "(no rows)" if not first else (first.get("conceptName") or f"({(first.get('latest') or {}).get('resourceType')})")
    return agrees, no_value, name


def obs_count(client, patient):
    status, body, _, _ = client.get(
        "/ws/rest/v1/obs", {"patient": patient, "limit": "1", "totalCount": "true", "v": "custom:(uuid)"}
    )
    if status == 200:
        return json.loads(body).get("totalCount")
    return None


def patient_status(client, patient):
    status, body, _, _ = client.get(f"{QS}/patient/{urllib.parse.quote(patient)}/status")
    return json.loads(body).get("status") if status == 200 else f"HTTP {status}"


def poll_until(client, patient, done, deadline, timeline, t0):
    """Polls GET .../status every 250 ms until done(status) or the deadline. Records each change of
    status in timeline as (seconds since t0, status). Returns (status, seconds since t0, polls)."""
    polls, status = 0, None
    while True:
        tick = time.perf_counter()
        status = patient_status(client, patient)
        polls += 1
        at = tick - t0
        if not timeline or timeline[-1][1] != status:
            timeline.append((round(at, 2), status))
        if done(status) or time.perf_counter() > deadline:
            return status, at, polls
        time.sleep(max(0.0, POLL_SECONDS - (time.perf_counter() - tick)))


def post_with_retry(client, path, data, timeout, attempts=5):
    """POST, honouring a 503's Retry-After (no projection slot free) a few times."""
    for _ in range(attempts):
        status, body, ms, headers = client.post(path, data, timeout=timeout)
        if status != 503:
            return status, body, ms
        wait = float(header(headers, "Retry-After") or 5)
        print(f"    {path}: 503, retrying in {wait:.0f} s")
        time.sleep(wait)
    return status, body, ms


def json_or_empty(body):
    try:
        return json.loads(body)
    except ValueError:
        return {}


def ensure_indexed(client, patient, timeout):
    """Leaves the chart indexed: a never-indexed chart is warmed and polled, anything else not indexed
    (failed, dropped) is reindexed. Only the index is written."""
    status = patient_status(client, patient)
    if status == "indexed":
        return status
    if status in ("not_indexed", "projecting"):
        if status == "not_indexed":
            post_with_retry(client, f"{QS}/patient/{urllib.parse.quote(patient)}/warm", None, timeout)
        t0 = time.perf_counter()
        status, _, _ = poll_until(client, patient, lambda s: s not in ("projecting", "not_indexed"), t0 + timeout, [], t0)
        if status == "indexed":
            return status
    code, body, _ = post_with_retry(client, f"{QS}/reindex", {"patient": patient}, timeout)
    print(f"    POST /querystore/reindex: HTTP {code} {json_or_empty(body).get('status', '')}")
    return patient_status(client, patient)


def throughput(client, patient, label, timeout):
    """Times one cold projection of the patient's chart. See the module docstring and DONE.md."""
    n_obs = obs_count(client, patient)
    before = patient_status(client, patient)
    timeline, encoded = [], urllib.parse.quote(patient)
    result = {"label": label, "patient": patient, "obs": n_obs, "before": before, "docs": None}

    if before == "not_indexed":
        # Genuinely cold: the path the omnibar triggers.
        result["method"] = "warm"
        t0 = time.perf_counter()
        code, body, _ = post_with_retry(client, f"{QS}/patient/{encoded}/warm", None, timeout)
        result["request"] = f"{code} {json_or_empty(body).get('status', '')}"
        # A warm that never started (503s past the retries) leaves nothing to wait for.
        deadline = t0 + timeout if code in (200, 202) else 0
        status, at, polls = poll_until(client, patient, lambda s: s not in ("projecting", "not_indexed"),
                                       deadline, timeline, t0)
        result.update(wall_s=at, indexed_at_s=at if status == "indexed" else None, polls=polls)
    else:
        # Already indexed: nothing on the REST surface clears a chart without re-projecting it in the
        # same call, so time the synchronous delete + re-projection of POST /reindex, polling status
        # alongside it so the projecting window is visible.
        result["method"] = "reindex"
        reply = {}

        def reindex():
            try:
                reply.update(zip(("code", "body", "ms"), post_with_retry(client, f"{QS}/reindex", {"patient": patient}, timeout)))
            except OSError as err:  # a timeout or a dropped connection: report it rather than a 0 s projection
                reply.update(code=type(err).__name__, body=json.dumps({"error": str(err)}).encode())

        t0 = time.perf_counter()
        worker = threading.Thread(target=reindex)
        worker.start()
        _, _, polls = poll_until(client, patient, lambda s: not worker.is_alive(), t0 + timeout, timeline, t0)
        worker.join()
        status, at, more = poll_until(client, patient, lambda s: s != "projecting", time.perf_counter() + 60, timeline, t0)
        body = json_or_empty(reply.get("body", b""))
        result.update(wall_s=reply["ms"] / 1000 if "ms" in reply else None, indexed_at_s=at if status == "indexed" else None,
                      polls=polls + more, docs=body.get("documentsIndexed"),
                      request=f"{reply.get('code')} {body.get('status') or body.get('error') or ''}".strip())
        # The warm a chart then gets is a no-op: an indexed chart answers 200 indexed at once.
        code, body, ms = post_with_retry(client, f"{QS}/patient/{encoded}/warm", None, timeout)
        result["warm_after"] = f"{code} {json_or_empty(body).get('status', '')} in {ms:.0f} ms"

    result["timeline"] = timeline
    wall = result["wall_s"]
    result["obs_per_s"] = n_obs / wall if n_obs and wall else None
    result["docs_per_s"] = result["docs"] / wall if result["docs"] and wall else None
    result["final"] = ensure_indexed(client, patient, timeout)
    return result


def find_keys(node, words):
    """Every leaf under a key containing one of words, for a system-information body whose keys vary."""
    found = []
    if isinstance(node, dict):
        for key, value in node.items():
            if not isinstance(value, (dict, list)) and any(w in key.lower() for w in words):
                found.append((key, value))
            found += find_keys(value, words)
    elif isinstance(node, list):
        for value in node:
            found += find_keys(value, words)
    return found


def preflight(client):
    status, body, _, _ = client.get(f"{QS}/indexingstatus")
    if status != 200:
        sys.exit(f"querystore indexingstatus HTTP {status}; is the module installed and started?")
    indexing = json.loads(body)
    backends = sorted({t.get("backend") for t in indexing.get("types", []) if t.get("backend")})
    status, body, _, _ = client.get("/ws/rest/v1/module/querystore", {"v": "full"})
    version = json.loads(body).get("version") if status == 200 else f"unavailable (HTTP {status})"
    status, body, _, _ = client.get("/ws/rest/v1/systeminformation")
    host = find_keys(json.loads(body), ("memory", "processor", "cpu")) if status == 200 else []
    info = {"backends": ", ".join(backends) or "unknown", "complete": indexing.get("complete"), "version": version,
            "host": "; ".join(f"{k}: {v}" for k, v in host) or f"not visible (systeminformation HTTP {status})"}
    print(f"querystore module version: {info['version']}")
    print(f"querystore backend(s): {info['backends']}; fully indexed: {info['complete']}")
    print(f"server CPU/memory: {info['host']}")
    if not indexing.get("complete"):
        print("WARNING: indexing is not complete, so some charts may be projected during the run.")
    return info


def pct(values, p):
    if not values:
        return None
    ordered = sorted(values)
    k = max(0, min(len(ordered) - 1, round(p / 100 * (len(ordered) - 1))))
    return ordered[k]


def fmt(v):
    return "" if v is None else f"{v:.0f}"


def fmt2(v):
    return "" if v is None else f"{v:.2f}"


def latest_cell(comparisons, varied):
    if not comparisons:
        return "n/a"
    counts = {c: sum(1 for x in comparisons if x["class"] == c) for c in CLASSES}
    extra = ", ".join(f"{counts[c]} {CLASS_LABELS[c]}" for c in CLASSES[1:] if counts[c])
    return f"{counts['correct']}/{len(comparisons)}" + (f" ({extra})" if extra else "") + (" *" if varied else "")


def first_cell(agrees, no_value):
    cell = "n/a" if agrees is None else "yes" if agrees else "no"
    return cell + (" (no value)" if no_value else "")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--patients", required=True, help="file of patient UUIDs, one per line, optional label after")
    ap.add_argument("--queries", nargs="*", default=DEFAULT_QUERIES)
    ap.add_argument("--runs", type=int, default=10, help="timed runs per pair, after one warm-up run")
    ap.add_argument("--pause", type=float, default=0.2, help="seconds between requests, to avoid hammering")
    ap.add_argument("--timeout", type=float, default=120)
    ap.add_argument("--throughput", action="store_true", help="time a cold projection for --throughput-patients")
    ap.add_argument("--throughput-patients", default="", help="comma-separated labels (or UUIDs) from --patients")
    ap.add_argument("--projection-timeout", type=float, default=3600,
                    help="seconds to allow one chart's projection (reindex request and status polling)")
    ap.add_argument("--skip-latency", action="store_true", help="only run --throughput")
    ap.add_argument("--out", default="bench-results-r2")
    args = ap.parse_args()

    base, user, password = (os.environ.get(k) for k in ("OPENMRS_BASE", "OPENMRS_USER", "OPENMRS_PASS"))
    if not all((base, user, password)):
        sys.exit("Set OPENMRS_BASE, OPENMRS_USER and OPENMRS_PASS in the environment.")

    patients = []
    with open(args.patients) as f:
        for line in f:
            parts = line.split()
            if parts and not parts[0].startswith("#"):
                patients.append((parts[0], parts[1] if len(parts) > 1 else ""))
    by_name = {name: p for p in patients for name in p if name}
    wanted = [w.strip() for w in args.throughput_patients.split(",") if w.strip()]
    if args.throughput and (not wanted or any(w not in by_name for w in wanted)):
        sys.exit(f"--throughput needs --throughput-patients from {args.patients}: {', '.join(p[1] or p[0] for p in patients)}")

    client = Client(base, user, password, args.timeout)
    info = preflight(client)
    os.makedirs(args.out, exist_ok=True)
    rows, summary, throughputs = [], [], []

    # Throughput first, so a never-indexed chart is timed on the real warm path before the latency
    # phase's own check warms it, and the latency phase then measures charts left freshly indexed.
    if args.throughput:
        for name in wanted:
            patient, label = by_name[name]
            print(f"\nThroughput: {patient} ({label or 'unlabelled'})")
            t = throughput(client, patient, label, args.projection_timeout)
            throughputs.append(t)
            rows.append({"path": f"throughput-{t['method']}", "patient": patient, "label": label, "obs": t["obs"],
                         "ms": "" if t["wall_s"] is None else round(t["wall_s"] * 1000, 1), "qs_status": t["final"],
                         "docs": t["docs"]})
            print(f"  {t['method']} ({t.get('request', '')}): {fmt2(t['wall_s'])} s for {t['obs']} obs ({fmt(t['obs_per_s'])} obs/s), "
                  f"docs {t['docs'] if t['docs'] is not None else '?'}, status {t['timeline']}, final {t['final']}")

    for index, (patient, label) in enumerate([] if args.skip_latency else patients, start=1):
        n_obs = obs_count(client, patient)
        print(f"\nPatient {patient} ({label or 'unlabelled'}), {n_obs if n_obs is not None else '?'} obs")
        status = ensure_indexed(client, patient, args.projection_timeout)
        print(f"  chart status before timing: {status}" + ("" if status == "indexed" else "  WARNING: runs will be flagged"))

        for query in args.queries:
            rest_ms = []
            qs = {v: {"ms": [], "server": [], "statuses": [], "signatures": set(), "last": None} for v in VARIANTS}
            rest = None
            for run in range(args.runs + 1):  # run 0 is a warm-up, excluded from stats
                rest = rest_path(client, patient, query)
                time.sleep(args.pause)
                rows.append({"path": "rest", "patient": patient, "label": label, "obs": n_obs, "query": query, "run": run,
                             "ms": round(rest["ms"], 1), "concept_ms": round(rest["concept_ms"], 1),
                             "obs_ms": round(rest["obs_ms"], 1), "groups": len(rest["latest"]),
                             "first_concept": rest["top"][0] if rest["top"] else "",
                             "first_name": rest["top"][1] if rest["top"] else ""})
                if run > 0:
                    rest_ms.append(rest["ms"])
                for v in VARIANTS:
                    r = qs_path(client, patient, query, v)
                    time.sleep(args.pause)
                    comparisons = compare_latest(rest, r["groups"])
                    agrees, no_value, name = first_row(rest, r["groups"])
                    counts = {c: sum(1 for x in comparisons if x["class"] == c) for c in CLASSES}
                    rows.append({"path": v, "patient": patient, "label": label, "obs": n_obs, "query": query, "run": run,
                                 "ms": round(r["ms"], 1), "server_ms": r["server_ms"], "http": r["http"],
                                 "qs_status": r["status"], "not_indexed": r["status"] != "indexed",
                                 "groups": len(r["groups"]),
                                 "first_concept": r["groups"][0].get("conceptUuid") if r["groups"] else "",
                                 "first_name": name, "first_agrees": agrees, "first_no_value": no_value,
                                 "compared": len(comparisons), **counts,
                                 "mismatches": ";".join(f"{x['class']}:{x['qs_uuid']}<>{x['rest_uuid']}"
                                                        for x in comparisons if x["class"] != "correct")})
                    if run == 0:
                        continue
                    s = qs[v]
                    s["statuses"].append(r["status"])
                    s["signatures"].add(tuple(x["class"] for x in comparisons))
                    if r["http"] == 200:
                        s["ms"].append(r["ms"])
                    if r["server_ms"] is not None:
                        s["server"].append(r["server_ms"])
                    # The pair is judged on its last timed run that was served indexed.
                    if r["status"] == "indexed" or s["last"] is None:
                        s["last"] = (comparisons, agrees, no_value, name)

            top = rest["top"]
            for v in VARIANTS:
                s = qs[v]
                comparisons, agrees, no_value, name = s["last"] or ([], None, None, "(no runs)")
                summary.append({
                    "variant": v, "patient": label or f"patient {index}", "obs": n_obs, "query": query,
                    "rest_p50": pct(rest_ms, 50), "rest_p95": pct(rest_ms, 95),
                    "qs_p50": pct(s["ms"], 50), "qs_p95": pct(s["ms"], 95), "qs_server_p50": pct(s["server"], 50),
                    "dropdown_top": f"{top[1]} ({(top[3] or '')[:10]})" if top else "no data",
                    "rest_first": top[1] if top else "(no data)", "qs_first": name,
                    "comparisons": comparisons, "varied": len(s["signatures"]) > 1,
                    "agrees": agrees, "no_value": no_value,
                    "not_indexed": [st for st in s["statuses"] if st != "indexed"],
                })
                x = summary[-1]
                print(f"  {query!r} {v}: rest p50 {fmt(x['rest_p50'])} ms, qs p50 {fmt(x['qs_p50'])} ms "
                      f"(server {fmt(x['qs_server_p50']) or 'n/a'}), latest {latest_cell(comparisons, x['varied'])}, "
                      f"first row {first_cell(agrees, no_value)}"
                      + (f", NOT INDEXED in {len(x['not_indexed'])} runs: {sorted(set(x['not_indexed']))}"
                         if x["not_indexed"] else ""))

    write_raw(os.path.join(args.out, "raw.csv"), rows)
    server_seen = any(x["qs_server_p50"] is not None for x in summary)
    for v in VARIANTS:
        write_summary(os.path.join(args.out, f"summary-{v}.md"), v, base, info, args.runs, server_seen,
                      [x for x in summary if x["variant"] == v])
    write_correctness(os.path.join(args.out, "correctness.md"), summary, args.queries)
    write_throughput(os.path.join(args.out, "throughput.md"), info, throughputs)
    print(f"\nWrote raw.csv, summary-A.md, summary-B.md, summary-C.md, correctness.md and throughput.md in {args.out}")


RAW_FIELDS = ["path", "patient", "label", "obs", "query", "run", "ms", "server_ms", "http", "qs_status", "not_indexed",
              "concept_ms", "obs_ms", "groups", "docs", "first_concept", "first_name", "first_agrees", "first_no_value",
              "compared", *CLASSES, "mismatches"]


def write_raw(path, rows):
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=RAW_FIELDS, restval="")
        writer.writeheader()
        writer.writerows(rows)


def variant_url(v):
    extra = "".join(f"&{k}={val}" for k, val in VARIANTS[v].items() if k != "mode")
    return (f"GET /ws/rest/v1/querystore/patient/{{uuid}}/search?q=<q>&mode={VARIANTS[v]['mode']}"
            f"&collapse=concept&limit=5&wait=false{extra}")


def write_summary(path, v, base, info, runs, server_seen, rows):
    server_note = ("the server's own time, from its timing header" if server_seen else
                   "blank: GET .../patient/{uuid}/search sends no timing header (neither X-Querystore-Millis "
                   "nor Server-Timing), so there is no server time to report")
    lines = [
        f"# Omnibar chart-lookup benchmark, round 2: variant {v}",
        "",
        f"- Server: {base}",
        f"- querystore module version: {info['version']}; backend(s): {info['backends']}; fully indexed: {info['complete']}",
        f"- Variant {v}: `{variant_url(v)}`",
        f"- Runs per pair: {runs} (after one warm-up), interleaved REST, A, B, C; times in ms, measured from the client",
        f"- QS server p50: {server_note}",
        "- Dropdown shows: the REST dropdown's first row, the latest obs of the first matching concept with data (per FHIR).",
        "- Latest correct: of the query store groups whose concept the REST path also found, how many have `latest` "
        "equal to FHIR's latest obs of that concept. A same-date tie picked another obs of the same day; older means "
        "the query store picked a genuinely older value. Judged on the last timed run served `indexed`; "
        "* means the classification varied between runs.",
        "- First row agrees: is the first group's concept the REST dropdown's first concept with data? "
        "\"(no value)\" marks a first row whose latest is not an obs value (an order, for example).",
        "",
        "| Patient | Obs | Query | REST p50 | REST p95 | QS p50 | QS p95 | QS server p50 | Dropdown shows | Latest correct | First row agrees |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for s in rows:
        lines.append(
            f"| {s['patient']} | {s['obs'] if s['obs'] is not None else ''} | `{s['query']}` | {fmt(s['rest_p50'])} | "
            f"{fmt(s['rest_p95'])} | {fmt(s['qs_p50'])} | {fmt(s['qs_p95'])} | {fmt(s['qs_server_p50'])} | "
            f"{s['dropdown_top']} | {latest_cell(s['comparisons'], s['varied'])} | {first_cell(s['agrees'], s['no_value'])} |"
        )
    flagged = [s for s in rows if s["not_indexed"]]
    lines += ["", "## Runs not served `indexed`", ""]
    if flagged:
        lines += ["| Patient | Query | Runs | Statuses |", "| --- | --- | --- | --- |"]
        lines += [f"| {s['patient']} | `{s['query']}` | {len(s['not_indexed'])} | {', '.join(sorted(set(s['not_indexed'])))} |"
                  for s in flagged]
    else:
        lines.append("None: every timed run answered `status: indexed`.")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def write_correctness(path, summary, queries):
    lines = ["# Latest-value correctness and first-row agreement", "",
             "Per variant, over every patient x query pair (each judged on its last timed run served `indexed`).", "",
             "| Variant | Groups compared | Correct | Same-date tie | Older | Other | First row agrees | No-value first rows | Pairs with non-indexed runs |",
             "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for v in VARIANTS:
        rows = [s for s in summary if s["variant"] == v]
        comparisons = [c for s in rows for c in s["comparisons"]]
        counts = {c: sum(1 for x in comparisons if x["class"] == c) for c in CLASSES}
        judged = [s for s in rows if s["agrees"] is not None]
        lines.append(f"| {v} | {len(comparisons)} | {counts['correct']} | {counts['tie']} | {counts['older']} | "
                     f"{counts['other']} | {sum(1 for s in judged if s['agrees'])}/{len(judged)} | "
                     f"{sum(1 for s in rows if s['no_value'])}/{sum(1 for s in rows if s['no_value'] is not None)} | "
                     f"{sum(1 for s in rows if s['not_indexed'])} |")

    pairs = {}
    for s in summary:
        pairs.setdefault((s["patient"], s["query"]), {"rest": s["rest_first"]})[s["variant"]] = (
            s["qs_first"] + (" (no value)" if s["no_value"] else ""))
    cd4 = [k for k in pairs if k[1].lower() == "cd4"]
    lines += ["", "## cd4: which concept comes first", ""]
    if cd4:
        lines += ["| Patient | REST | A | B | C |", "| --- | --- | --- | --- | --- |"]
        lines += [f"| {p} | {pairs[(p, q)]['rest']} | {pairs[(p, q)].get('A', '')} | {pairs[(p, q)].get('B', '')} | "
                  f"{pairs[(p, q)].get('C', '')} |" for p, q in cd4]
    else:
        lines.append("Not measured: `cd4` was not among the queries.")

    lines += ["", "## First row per pair", "", "| Patient | Query | REST | A | B | C |", "| --- | --- | --- | --- | --- | --- |"]
    lines += [f"| {p} | `{q}` | {r['rest']} | {r.get('A', '')} | {r.get('B', '')} | {r.get('C', '')} |"
              for (p, q), r in pairs.items()]

    misses = [(s, c) for s in summary for c in s["comparisons"] if c["class"] != "correct"]
    lines += ["", "## Groups whose latest is not FHIR's latest", ""]
    if misses:
        lines += ["Dates are calendar days in UTC, the query store's convention.", "",
                  "| Variant | Patient | Query | Concept | Class | QS latest | FHIR latest |", "| --- | --- | --- | --- | --- | --- | --- |"]
        lines += [f"| {s['variant']} | {s['patient']} | `{s['query']}` | {c['concept']} | {CLASS_LABELS[c['class']]} | "
                  f"{c['qs_type']} {c['qs_day'] or '(no date)'} | obs {c['rest_day'] or '(no date)'} |" for s, c in misses]
    else:
        lines.append("None.")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def write_throughput(path, info, throughputs):
    lines = ["# Projection throughput", "",
             f"- querystore module version: {info['version']}; backend(s): {info['backends']}",
             f"- Server CPU/memory: {info['host']}",
             "- Method `warm`: the chart read `not_indexed`, so POST .../warm started a background projection and "
             "GET .../status was polled every 250 ms until it left `projecting`. Wall s runs from the POST to the first "
             "poll reading `indexed`.",
             "- Method `reindex`: the chart was already indexed, and no REST endpoint clears one chart without "
             "re-projecting it in the same call (the benchmark endpoint's cold=true runs the same reindex synchronously). "
             "So POST /querystore/reindex {\"patient\"} was timed: it deletes the chart and re-projects every type before "
             "it returns. Wall s is that request's client time; status was polled every 250 ms alongside it. A warm "
             "posted afterwards is a no-op on an indexed chart, recorded to show it.",
             "- Obs/s divides the patient's obs count (REST totalCount) by wall s. Docs come from the reindex response's "
             "documentsIndexed; the warm path has no per-chart document count on the REST surface.",
             ""]
    if not throughputs:
        lines.append("Not run (pass --throughput --throughput-patients ...).")
    else:
        lines += ["| Patient | Obs | Docs | Before | Method | Request | Wall s | Obs/s | Docs/s | Indexed seen at s | "
                  "Polls | Status timeline (s) | Warm after | Final |",
                  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
        for t in throughputs:
            timeline = " → ".join(f"{s}@{at:.2f}" for at, s in t["timeline"])
            lines.append(
                f"| {t['label'] or 'unlabelled'} | {t['obs'] if t['obs'] is not None else ''} | "
                f"{t['docs'] if t['docs'] is not None else ''} | {t['before']} | {t['method']} | {t.get('request', '')} | "
                f"{fmt2(t['wall_s'])} | {fmt(t['obs_per_s'])} | {fmt(t['docs_per_s'])} | "
                f"{fmt2(t['indexed_at_s'])} | {t['polls']} | {timeline} | "
                f"{t.get('warm_after', '')} | {t['final']} |")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
