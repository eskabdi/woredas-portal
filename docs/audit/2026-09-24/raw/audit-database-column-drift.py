#!/usr/bin/env python3
"""Column-level drift: types.ts public.Tables.<t>.Row vs columns created in migrations
(CREATE TABLE bodies + ALTER TABLE ... ADD COLUMN). Read-only."""
import re, glob, os, json
root = os.getcwd()
t = open("src/integrations/supabase/types.ts").read()
p = t[t.find("\n  public: {"):]
tabs = p[p.find("    Tables: {"):p.find("    Views: {")]
types_cols = {}
for m in re.finditer(r"^      ([a-z_0-9]+): \{\n        Row: \{\n(.*?)\n        \}", tabs, re.M | re.S):
    types_cols[m.group(1)] = set(re.findall(r"^          ([a-z_0-9]+)\??:", m.group(2), re.M))
mig_cols = {}
for f in sorted(glob.glob("supabase/migrations/*.sql")):
    s = open(f).read()
    s = re.sub(r"--[^\n]*", "", s)
    for m in re.finditer(r"CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_0-9]+)\s*\((.*?)\n\);", s, re.S | re.I):
        cols = set()
        for line in m.group(2).split("\n"):
            line = line.strip()
            mm = re.match(r"([a-z_][a-z_0-9]*)\s+(uuid|text|int|integer|smallint|bigint|numeric|boolean|bool|date|timestamp|timestamptz|jsonb|json|bytea|double|real|character|varchar|serial|inet|time)", line, re.I)
            if mm and mm.group(1).upper() not in ("CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"):
                cols.add(mm.group(1).lower())
        mig_cols.setdefault(m.group(1).lower(), set()).update(cols)
    for m in re.finditer(r"ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\.)?([a-z_0-9]+)\s+(.*?);", s, re.S | re.I):
        for mm in re.finditer(r"ADD COLUMN (?:IF NOT EXISTS )?([a-z_0-9]+)", m.group(2), re.I):
            mig_cols.setdefault(m.group(1).lower(), set()).add(mm.group(1).lower())
out = {}
for tb in sorted(set(types_cols) | set(mig_cols)):
    a, b = types_cols.get(tb, set()), mig_cols.get(tb, set())
    if a - b or b - a:
        out[tb] = {"in_types_not_migrations": sorted(a - b), "in_migrations_not_types": sorted(b - a)}
json.dump(out, open("docs/audit/2026-09-24/raw/audit-database-column-drift.json", "w"), indent=1)
print(json.dumps(out, indent=1))
