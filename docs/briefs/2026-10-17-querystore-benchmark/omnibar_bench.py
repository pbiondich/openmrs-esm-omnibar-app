#!/usr/bin/env python3
"""
Omnibar chart-lookup benchmark: current REST/FHIR path vs querystore.

For each (patient, query) pair it times two ways of answering what the omnibar dropdown shows
when a user types something like "cd4" inside a chart:

  A. "rest"  - what esm-omnibar-app's chart-lookup provider does today:
               GET /ws/rest/v1/concept?q=...   then
               GET /ws/fhir2/R4/Observation?subject:Patient=...&code=...&_sort=-date&_count=50
  B. "qs"    - one call to querystore's hybrid search, through the benchmark-only endpoint
               GET /ws/rest/v1/querystore/search?patient=...&q=...&limit=50
               (see HANDOFF.md; querystore has no search REST endpoint of its own yet)

It also checks correctness: the dropdown promises the *latest* value, so for each query it
records where the latest matching observation (according to FHIR) ranks in querystore's results.

Standard library only. Credentials come from the environment, never the command line:

  export OPENMRS_BASE=https://o3.pgb.md/openmrs
  export OPENMRS_USER=...
  export OPENMRS_PASS=...
  python3 omnibar_bench.py --patients patients.txt --runs 10

patients.txt holds one patient UUID per line, optionally followed by a label:
  8673ee4f-e2ab-4077-ba55-4980f408773e  large
  1e2b7c3a-...                           small
"""

import argparse
import base64
import csv
import http.cookiejar
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_QUERIES = ["cd4", "hb", "weight", "creatinine", "viral load", "temperature"]
NON_VALUE_DATATYPES = {"N/A", "Complex", "Rule", "Structured Numeric"}
CONCEPT_REP = "custom:(uuid,display,datatype:(display))"


class Client:
    """Session-cookie client, so both paths pay the same (cookie) auth cost per request."""

    def __init__(self, base, user, password, timeout):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        status, body, _, _ = self.get("/ws/rest/v1/session", headers={"Authorization": f"Basic {token}"})
        if status != 200 or not json.loads(body).get("authenticated"):
            sys.exit(f"Login failed (HTTP {status}). Check OPENMRS_BASE, OPENMRS_USER, OPENMRS_PASS.")

    def request(self, method, path, params=None, headers=None, data=None):
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params, safe=":,")
        req = urllib.request.Request(url, method=method, headers={"Accept": "application/json", **(headers or {})})
        if data is not None:
            req.data = json.dumps(data).encode()
            req.add_header("Content-Type", "application/json")
        start = time.perf_counter()
        try:
            with self.opener.open(req, timeout=self.timeout) as resp:
                body = resp.read()
                elapsed = (time.perf_counter() - start) * 1000
                return resp.status, body, elapsed, dict(resp.headers)
        except urllib.error.HTTPError as err:
            elapsed = (time.perf_counter() - start) * 1000
            return err.code, err.read(), elapsed, dict(err.headers)

    def get(self, path, params=None, headers=None):
        return self.request("GET", path, params=params, headers=headers)


def rest_path(client, patient, query):
    """Path A. Returns timings, the latest obs uuid per concept, and the dropdown's top answer."""
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


def qs_path(client, patient, query, cold=False):
    """Path B. Returns timing, querystore's self-reported service time, and the hits."""
    params = {"patient": patient, "q": query, "limit": "50"}
    if cold:
        params["cold"] = "true"
    status, body, ms, headers = client.get("/ws/rest/v1/querystore/search", params)
    if status == 404:
        sys.exit("GET /ws/rest/v1/querystore/search returned 404. Add the benchmark endpoint first (HANDOFF.md, step 2).")
    if status != 200:
        raise RuntimeError(f"querystore search HTTP {status}: {body[:200]!r}")
    hits = json.loads(body)
    server_ms = headers.get("X-Querystore-Millis") or headers.get("x-querystore-millis")
    return {"ms": ms, "server_ms": float(server_ms) if server_ms else None, "hits": hits}


def latest_rank(rest, qs):
    """1-based rank of the dropdown's top answer (latest obs of the first matching concept) in
    querystore's hits; 0 if absent from the top 50. Also the rank of the first hit belonging to
    that concept at all, to separate "found the concept" from "found the latest value"."""
    if not rest["top"]:
        return None, None
    concept_uuid, _, latest_obs_uuid, _ = rest["top"]
    concept_obs = set(rest["obs_by_concept"].get(concept_uuid, []))
    rank_latest = rank_concept = 0
    for i, hit in enumerate(qs["hits"], start=1):
        uuid = hit.get("resourceUuid")
        if not rank_concept and uuid in concept_obs:
            rank_concept = i
        if uuid == latest_obs_uuid:
            rank_latest = i
            break
    return rank_latest, rank_concept


def obs_count(client, patient):
    status, body, _, _ = client.get(
        "/ws/rest/v1/obs", {"patient": patient, "limit": "1", "totalCount": "true", "v": "custom:(uuid)"}
    )
    if status == 200:
        return json.loads(body).get("totalCount")
    return None


def pct(values, p):
    if not values:
        return None
    ordered = sorted(values)
    k = max(0, min(len(ordered) - 1, round(p / 100 * (len(ordered) - 1))))
    return ordered[k]


def fmt(v):
    return "" if v is None else f"{v:.0f}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--patients", required=True, help="file of patient UUIDs, one per line, optional label after")
    ap.add_argument("--queries", nargs="*", default=DEFAULT_QUERIES)
    ap.add_argument("--runs", type=int, default=10, help="timed runs per pair, after one warm-up run")
    ap.add_argument("--cold", action="store_true",
                    help="also time one cold querystore search per patient (clears that patient's index first)")
    ap.add_argument("--pause", type=float, default=0.2, help="seconds between requests, to avoid hammering")
    ap.add_argument("--timeout", type=float, default=120)
    ap.add_argument("--out", default="bench-results")
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

    client = Client(base, user, password, args.timeout)

    # Preflight: is querystore installed and fully indexed?
    status, body, _, _ = client.get("/ws/rest/v1/querystore/indexingstatus")
    if status != 200:
        sys.exit(f"querystore indexingstatus HTTP {status}; is the module installed and started?")
    indexing = json.loads(body)
    backends = sorted({t.get("backend") for t in indexing.get("types", []) if t.get("backend")})
    print(f"querystore backend(s): {', '.join(backends) or 'unknown'}; fully indexed: {indexing.get('complete')}")
    if not indexing.get("complete"):
        print("WARNING: indexing is not complete, so warm-path numbers may include cold projections.")

    os.makedirs(args.out, exist_ok=True)
    raw_path = os.path.join(args.out, "raw.csv")
    rows, summary = [], []

    for patient, label in patients:
        n_obs = obs_count(client, patient)
        print(f"\nPatient {patient} ({label or 'unlabelled'}), {n_obs if n_obs is not None else '?'} obs")

        if args.cold:
            # One cold search: clears this patient's documents, then the search re-projects them.
            cold = qs_path(client, patient, args.queries[0], cold=True)
            rows.append({"path": "qs-cold", "patient": patient, "label": label, "obs": n_obs, "query": args.queries[0],
                         "run": 0, "ms": round(cold["ms"], 1), "server_ms": cold["server_ms"],
                         "concept_ms": "", "obs_ms": "", "hits": len(cold["hits"]), "rank_latest": "", "rank_concept": ""})
            print(f"  cold querystore search: {cold['ms']:.0f} ms (server {fmt(cold['server_ms'])} ms)")
            time.sleep(args.pause)

        for query in args.queries:
            rest_ms, qs_ms, qs_server_ms, ranks = [], [], [], []
            for run in range(args.runs + 1):  # run 0 is a warm-up, excluded from stats
                rest = rest_path(client, patient, query)
                time.sleep(args.pause)
                qs = qs_path(client, patient, query)
                time.sleep(args.pause)
                rank_latest, rank_concept = latest_rank(rest, qs)
                rows.append({"path": "rest", "patient": patient, "label": label, "obs": n_obs, "query": query, "run": run,
                             "ms": round(rest["ms"], 1), "server_ms": "", "concept_ms": round(rest["concept_ms"], 1),
                             "obs_ms": round(rest["obs_ms"], 1), "hits": len(rest["latest"]),
                             "rank_latest": "", "rank_concept": ""})
                rows.append({"path": "qs", "patient": patient, "label": label, "obs": n_obs, "query": query, "run": run,
                             "ms": round(qs["ms"], 1), "server_ms": qs["server_ms"], "concept_ms": "", "obs_ms": "",
                             "hits": len(qs["hits"]), "rank_latest": rank_latest, "rank_concept": rank_concept})
                if run > 0:
                    rest_ms.append(rest["ms"])
                    qs_ms.append(qs["ms"])
                    if qs["server_ms"] is not None:
                        qs_server_ms.append(qs["server_ms"])
                    ranks.append(rank_latest)

            top = rest["top"]
            summary.append({
                "patient": label or patient[:8], "obs": n_obs, "query": query,
                "rest_p50": pct(rest_ms, 50), "rest_p95": pct(rest_ms, 95),
                "qs_p50": pct(qs_ms, 50), "qs_p95": pct(qs_ms, 95),
                "qs_server_p50": pct(qs_server_ms, 50),
                "dropdown_top": f"{top[1]} ({(top[3] or '')[:10]})" if top else "no data",
                "latest_rank": statistics.mode(ranks) if ranks and top else None,
            })
            s = summary[-1]
            print(f"  {query!r}: rest p50 {fmt(s['rest_p50'])} ms, qs p50 {fmt(s['qs_p50'])} ms "
                  f"(server {fmt(s['qs_server_p50'])}), latest value at qs rank {s['latest_rank']}")

    with open(raw_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    lines = [
        "# Omnibar chart-lookup benchmark",
        "",
        f"- Server: {base}",
        f"- querystore backend(s): {', '.join(backends) or 'unknown'}; fully indexed: {indexing.get('complete')}",
        f"- Runs per pair: {args.runs} (after one warm-up); times in ms, measured from the client",
        "- Latest rank: where the value the dropdown would show (latest obs of the first matching concept, per FHIR) "
        "appears in querystore's results. 1 is ideal; 0 means not in the top 50; blank means no data.",
        "",
        "| Patient | Obs | Query | REST p50 | REST p95 | QS p50 | QS p95 | QS server p50 | Dropdown shows | Latest rank |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for s in summary:
        lines.append(
            f"| {s['patient']} | {s['obs'] if s['obs'] is not None else ''} | `{s['query']}` | {fmt(s['rest_p50'])} | "
            f"{fmt(s['rest_p95'])} | {fmt(s['qs_p50'])} | {fmt(s['qs_p95'])} | {fmt(s['qs_server_p50'])} | "
            f"{s['dropdown_top']} | {'' if s['latest_rank'] is None else s['latest_rank']} |"
        )
    cold_rows = [r for r in rows if r["path"] == "qs-cold"]
    if cold_rows:
        lines += ["", "## Cold querystore searches", "", "| Patient | Obs | Client ms | Server ms |", "| --- | --- | --- | --- |"]
        for r in cold_rows:
            lines.append(f"| {r['label'] or r['patient'][:8]} | {r['obs'] or ''} | {r['ms']:.0f} | {fmt(r['server_ms'])} |")

    summary_path = os.path.join(args.out, "summary.md")
    with open(summary_path, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"\nWrote {summary_path} and {raw_path}")


if __name__ == "__main__":
    main()
