#!/usr/bin/env python3
"""Replay GRANT/REVOKE EXECUTE ON FUNCTION statements over the latest function set.
Model: Supabase stock default ACL => every new public function is EXECUTE-able by
PUBLIC (Postgres default) + anon + authenticated + service_role (pg_default_acl).
A function is anon-callable unless BOTH PUBLIC and anon were revoked afterwards
(or it was re-created with DROP, which resets ACL).  Output: per-function status."""
import json, re, os, sys
here = os.path.dirname(os.path.abspath(__file__))
cat = json.load(open(os.path.join(here, "audit-database-catalog.json")))
inv = open(os.path.join(here, "audit-database-rls-inventory.txt"), encoding="utf-8").read()
grants = re.findall(r"^- (supabase/migrations/\S+): ((?:GRANT|REVOKE) .*)$", inv, re.M)
fns = cat["functions"]; hist = cat["function_history"]
acl = {f: {"public": True, "anon": True, "authenticated": True} for f in fns}
def fileno(loc): return int(re.search(r"/(\d{14})_", loc).group(1))
first_def = {f: min(fileno(h["loc"]) for h in hist[f] if "loc" in h) for f in fns}
log = {f: [] for f in fns}
for loc, st in grants:
    m = re.match(r"(GRANT|REVOKE) (?:ALL|EXECUTE)(?: PRIVILEGES)? ON FUNCTION (.+?) (TO|FROM) (.+)$", st, re.I)
    if not m: continue
    verb, targets, _, roles = m.groups()
    roles = [r.strip().lower() for r in roles.split(",")]
    names = re.findall(r"(?:public\.)?([a-z_0-9]+)\s*\(", targets, re.I)
    for n in names:
        n = n.lower()
        if n not in acl: continue
        for r in roles:
            r = r.replace(";", "")
            if r in acl[n]:
                acl[n][r] = (verb.upper() == "GRANT")
        log[n].append(f"{loc} {verb} {roles}")
rows = []
for f in sorted(fns):
    d = fns[f]
    anon = acl[f]["public"] or acl[f]["anon"]
    rows.append({"fn": f, "definer": d["definer"], "anon_exec": anon, "public": acl[f]["public"],
                 "anon": acl[f]["anon"], "authenticated": acl[f]["authenticated"] or acl[f]["public"],
                 "loc": d["loc"], "grant_log": log[f]})
json.dump(rows, open(os.path.join(here, "audit-database-fn-acl.json"), "w"), indent=1)
with open(os.path.join(here, "audit-database-fn-acl.txt"), "w") as fh:
    fh.write("fn | definer | anon-executable(modelled) | PUBLIC | anon | latest def\n")
    for r in rows:
        fh.write(f"{r['fn']} | {r['definer']} | {r['anon_exec']} | {r['public']} | {r['anon']} | {r['loc']}\n")
print(sum(1 for r in rows if r['anon_exec']), "anon-exec of", len(rows))
for r in rows:
    if r['anon_exec'] and r['definer']: print("DEFINER+ANON:", r['fn'], r['loc'])
