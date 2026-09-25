#!/usr/bin/env python3
"""Extract every FK (table.col -> ref_table.ref_col, ON DELETE) from migrations. Read-only."""
import re, glob, json
fks = {}
for f in sorted(glob.glob("supabase/migrations/*.sql")):
    raw = open(f).read()
    s = re.sub(r"--[^\n]*", "", raw)
    base = f.split("/")[-1]
    # ALTER TABLE x ADD CONSTRAINT n FOREIGN KEY (c) REFERENCES t(c) ...
    for m in re.finditer(r"ALTER TABLE (?:ONLY )?(?:IF EXISTS )?(?:public\.)?([a-z_0-9]+)\s+ADD CONSTRAINT ([a-z_0-9]+)\s+FOREIGN KEY \(([^)]+)\) REFERENCES (?:public\.|auth\.)?([a-z_0-9]+)\s*\(([^)]+)\)([^;,]*)", s, re.I):
        line = raw[:raw.find(m.group(2))].count("\n") + 1 if m.group(2) in raw else 0
        fks[(m.group(1), m.group(3).strip())] = {"table": m.group(1), "col": m.group(3).strip(), "ref": m.group(4), "ref_col": m.group(5).strip(),
                                                 "on_delete": (re.search(r"ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION)", m.group(6), re.I) or [None, None])[1], "loc": f"supabase/migrations/{base}:{line}"}
    # inline: CREATE TABLE t ( col type ... REFERENCES r(c) ... )
    for m in re.finditer(r"CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_0-9]+)\s*\((.*?)\n\);", s, re.S | re.I):
        for line_ in m.group(2).split("\n"):
            mm = re.match(r"\s*([a-z_0-9]+)\s+\w+.*?REFERENCES (?:public\.|auth\.)?([a-z_0-9]+)\s*\(([^)]+)\)(.*)", line_, re.I)
            if mm:
                ln = raw.find(line_.strip()[:40]); ln = raw[:ln].count("\n") + 1 if ln >= 0 else 0
                fks[(m.group(1), mm.group(1))] = {"table": m.group(1), "col": mm.group(1), "ref": mm.group(2), "ref_col": mm.group(3),
                    "on_delete": (re.search(r"ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION)", mm.group(4), re.I) or [None, None])[1], "loc": f"supabase/migrations/{base}:{ln}"}
    # ADD COLUMN c type REFERENCES r(c)
    for m in re.finditer(r"ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\.)?([a-z_0-9]+)\s+(.*?);", s, re.S | re.I):
        for mm in re.finditer(r"ADD COLUMN (?:IF NOT EXISTS )?([a-z_0-9]+)\s+\w+[^,;]*?REFERENCES (?:public\.|auth\.)?([a-z_0-9]+)\s*\(([^)]+)\)([^,;]*)", m.group(2), re.I):
            fks[(m.group(1), mm.group(1))] = {"table": m.group(1), "col": mm.group(1), "ref": mm.group(2), "ref_col": mm.group(3),
                "on_delete": (re.search(r"ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION)", mm.group(4), re.I) or [None, None])[1], "loc": f"supabase/migrations/{base}"}
out = sorted(fks.values(), key=lambda x: (x["table"], x["col"]))
json.dump(out, open("docs/audit/2026-09-24/raw/audit-database-fks.json", "w"), indent=1)
print(len(out), "FKs")
