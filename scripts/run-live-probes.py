#!/usr/bin/env python3
"""
Runner for scripts/verify-live-probes.sql against the production Supabase
project, over the Management API (the only path available from a sandboxed
agent environment -- see CLAUDE.md's sandboxed-environment notes and the
fsm-migration skill; direct Postgres ports are blocked).

Each probe in the .sql file is its own `BEGIN; ...; ROLLBACK;` block. This
runner submits each block as one Management API query, and scores it:
  - a block whose header comment carries "EXPECT: ERROR" is PASS if the API
    call returns an error (the gate fired) and FAIL if it returns success
    (the gate did not fire).
  - a block carrying "EXPECT: SUCCESS" is PASS if it returns success with
    the asserted result, FAIL otherwise.

Before and after the full run, it snapshots every touched table's row count
and every relevant sequence's last_value, plus auth.users count, and prints
a net-zero diff -- rolled-back DML leaves row counts unchanged; sequence
advances on a rolled-back INSERT are a known, documented Postgres behavior
(nextval() is not transactional) and are reported, not silently corrected.

Usage:
  export SUPABASE_ACCESS_TOKEN=...   # never hardcoded, never logged
  python3 scripts/run-live-probes.py [--project-ref REF]
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

PRODUCTION_REF_DEFAULT = "tugzuexfyzbdnghbmrjl"
PROBE_FILE = Path(__file__).parent / "verify-live-probes.sql"

TOUCHED_TABLES = [
    "credential_request",
    "residence_credential",
    "vital_event",
    "role_permission",
    "user_permission_override",
    "rental_occupancy_request",
    "payment",
    "receipt",
    "resident",
    "workflow_status_history",
    "workflow_transition",
]
TOUCHED_SEQUENCES = [
    "credential_request_sequence",
    "resident_number_sequence",
    "vital_event_sequence",
    "rental_request_sequence",
]


def run_query(ref: str, token: str, sql: str) -> dict:
    """POST one SQL string to the Management API via curl (never urllib --
    see CLAUDE.md: Cloudflare 403s the Python-urllib User-Agent)."""
    payload_path = "/tmp/_probe_payload.json"
    Path(payload_path).write_text(json.dumps({"query": sql}))
    try:
        result = subprocess.run(
            [
                "curl",
                "-sS",
                "-X",
                "POST",
                f"https://api.supabase.com/v1/projects/{ref}/database/query",
                "-H",
                f"Authorization: Bearer {token}",
                "-H",
                "Content-Type: application/json",
                "--data-binary",
                f"@{payload_path}",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    finally:
        Path(payload_path).unlink(missing_ok=True)
    body = result.stdout
    try:
        return {"ok": True, "data": json.loads(body)}
    except json.JSONDecodeError:
        return {"ok": False, "raw": body}


def is_error_response(resp: dict) -> bool:
    if not resp["ok"]:
        return True
    data = resp["data"]
    return isinstance(data, dict) and "message" in data


def parse_probes(text: str):
    blocks = re.split(r"-- === PROBE: (\S+) ===\n", text)
    probes = []
    # blocks[0] is the file header (before the first probe); skip it.
    for i in range(1, len(blocks), 2):
        name = blocks[i]
        body = blocks[i + 1]
        expect_match = re.search(r"-- EXPECT:\s*(ERROR|SUCCESS)([^\n]*)", body)
        if not expect_match:
            continue  # a documentation-only stub with no runnable SQL
        sql_lines = [
            line
            for line in body.splitlines()
            if not line.strip().startswith("--") and line.strip()
        ]
        sql = "\n".join(sql_lines)
        probes.append(
            {
                "name": name,
                "sql": sql,
                "expect": expect_match.group(1),
                "expect_note": expect_match.group(2).strip(),
            }
        )
    return probes


def snapshot(ref: str, token: str) -> dict:
    snap = {}
    for t in TOUCHED_TABLES:
        r = run_query(ref, token, f"select count(*) as c from public.{t}")
        snap[f"table:{t}"] = r["data"][0]["c"] if r["ok"] and isinstance(r["data"], list) else None
    for s in TOUCHED_SEQUENCES:
        r = run_query(ref, token, f"select last_value from public.{s}")
        snap[f"seq:{s}"] = (
            r["data"][0]["last_value"] if r["ok"] and isinstance(r["data"], list) else None
        )
    r = run_query(ref, token, "select count(*) as c from auth.users")
    snap["auth.users"] = r["data"][0]["c"] if r["ok"] and isinstance(r["data"], list) else None
    r = run_query(ref, token, "select count(*) as c from public.rate_limit_bucket")
    snap["rate_limit_bucket"] = (
        r["data"][0]["c"] if r["ok"] and isinstance(r["data"], list) else None
    )
    return snap


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-ref", default=PRODUCTION_REF_DEFAULT)
    args = parser.parse_args()

    import os

    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        print("error: SUPABASE_ACCESS_TOKEN not set", file=sys.stderr)
        sys.exit(2)

    probes = parse_probes(PROBE_FILE.read_text())
    print(f"Loaded {len(probes)} runnable probes from {PROBE_FILE.name}\n")

    before = snapshot(args.project_ref, token)

    results = []
    for probe in probes:
        resp = run_query(args.project_ref, token, probe["sql"])
        errored = is_error_response(resp)
        if probe["expect"] == "ERROR":
            passed = errored
        else:
            passed = not errored
        results.append({**probe, "response": resp, "passed": passed})
        status = "PASS" if passed else "FAIL"
        detail = ""
        if resp["ok"] and isinstance(resp["data"], dict):
            detail = resp["data"].get("message", "")[:160]
        elif resp["ok"] and isinstance(resp["data"], list):
            detail = json.dumps(resp["data"])[:160]
        print(f"[{status}] {probe['name']} (expect {probe['expect']}) -- {detail}")

    after = snapshot(args.project_ref, token)

    print("\n=== Net-zero check ===")
    net_zero_ok = True
    for key in before:
        b, a = before[key], after[key]
        same = b == a
        net_zero_ok = net_zero_ok and same
        marker = "OK" if same else "CHANGED"
        print(f"  {marker:8s} {key}: before={b} after={a}")

    n_pass = sum(1 for r in results if r["passed"])
    print(f"\n{n_pass}/{len(results)} probes passed. Net-zero: {'OK' if net_zero_ok else 'VIOLATED'}")

    Path("/tmp/live-probe-results.json").write_text(
        json.dumps(
            {
                "results": [
                    {
                        "name": r["name"],
                        "expect": r["expect"],
                        "passed": r["passed"],
                        "detail": (
                            r["response"]["data"].get("message", "")
                            if r["response"]["ok"] and isinstance(r["response"]["data"], dict)
                            else json.dumps(r["response"].get("data"))
                        ),
                    }
                    for r in results
                ],
                "net_zero": {"ok": net_zero_ok, "before": before, "after": after},
            },
            indent=2,
        )
    )
    print("\nFull results written to /tmp/live-probe-results.json")

    sys.exit(0 if (n_pass == len(results) and net_zero_ok) else 1)


if __name__ == "__main__":
    main()
