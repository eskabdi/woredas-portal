#!/usr/bin/env python3
"""audit-database: static catalog reconstruction from supabase/migrations/*.sql.

Read-only. Splits every migration into statements (respecting quotes, dollar
quoting and comments), replays them in filename order and reports the LATEST
state of: tables, RLS enable/force, policies, views + security_invoker,
functions (SECURITY DEFINER, search_path), grants/revokes, triggers, sequences,
storage buckets. Output: JSON + text reports next to this file.
"""
import json, os, re, sys, glob, collections

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
MIG = sorted(glob.glob(os.path.join(ROOT, "supabase/migrations/*.sql")))
OUT = os.path.dirname(os.path.abspath(__file__))


def split_statements(text):
    """Yield (start_line, stmt) honouring '...', "...", $tag$...$tag$, -- and /* */."""
    i, n = 0, len(text)
    buf_start = 0
    line = 1
    stmt_line = 1
    started = False
    out = []
    while i < n:
        c = text[i]
        if c == "\n":
            line += 1
            i += 1
            continue
        if not started and not c.isspace():
            if text.startswith("--", i):
                j = text.find("\n", i)
                i = n if j < 0 else j
                continue
            if text.startswith("/*", i):
                j = text.find("*/", i)
                j = n if j < 0 else j + 2
                line += text.count("\n", i, j)
                i = j
                continue
            started = True
            buf_start = i
            stmt_line = line
        if text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i)
            j = n if j < 0 else j + 2
            line += text.count("\n", i, j)
            i = j
            continue
        if c == "'":
            j = i + 1
            while j < n:
                if text[j] == "'" and j + 1 < n and text[j + 1] == "'":
                    j += 2
                    continue
                if text[j] == "'":
                    break
                j += 1
            line += text.count("\n", i, j + 1)
            i = j + 1
            continue
        if c == '"':
            j = text.find('"', i + 1)
            j = n if j < 0 else j
            line += text.count("\n", i, j + 1)
            i = j + 1
            continue
        if c == "$":
            m = re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", text[i:])
            if m:
                tag = m.group(0)
                j = text.find(tag, i + len(tag))
                j = n if j < 0 else j + len(tag)
                line += text.count("\n", i, j)
                i = j
                continue
        if c == ";":
            if started:
                out.append((stmt_line, text[buf_start:i].strip()))
            started = False
            i += 1
            continue
        i += 1
    if started and text[buf_start:].strip():
        out.append((stmt_line, text[buf_start:].strip()))
    return out


def strip_comments(s):
    # remove -- comments outside quotes (approximate; fine for DDL headers)
    return re.sub(r"--[^\n]*", "", s)


def norm(name):
    name = name.strip().strip('"')
    name = re.sub(r'^"?public"?\.', "", name)
    return name.strip('"').lower()


ID = r'(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)'
QID = rf"(?:{ID}\.)?{ID}"

tables = collections.OrderedDict()   # name -> {file,line,rls,force,policies{}}
views = collections.OrderedDict()
functions = {}                       # name -> latest {file,line,definer,search_path,args,body}
func_hist = collections.defaultdict(list)
grants = []                          # (file,line,stmt)
triggers = {}                        # (table,name) -> {...}
sequences = []
buckets = []
storage_policies = {}
events = []  # chronological log


def extract_paren(s, start):
    """return content of balanced parentheses beginning at s[start]=='('"""
    depth = 0
    for k in range(start, len(s)):
        if s[k] == "(":
            depth += 1
        elif s[k] == ")":
            depth -= 1
            if depth == 0:
                return s[start + 1:k], k + 1
    return s[start + 1:], len(s)


for path in MIG:
    fname = os.path.basename(path)
    text = open(path, encoding="utf-8").read()
    for ln, raw in split_statements(text):
        st = strip_comments(raw)
        s = " ".join(st.split())
        u = s.upper()
        loc = f"supabase/migrations/{fname}:{ln}"
        # CREATE TABLE
        m = re.match(rf"CREATE TABLE (?:IF NOT EXISTS )?({QID})", s, re.I)
        if m:
            t = norm(m.group(1))
            if "." in m.group(1) and not m.group(1).lower().startswith(("public.", '"public".')):
                continue
            has_woreda = bool(re.search(r"\bworeda_id\b", s, re.I))
            wnn = bool(re.search(r"\bworeda_id\s+uuid\s+NOT NULL", s, re.I))
            tables.setdefault(t, {"created": loc, "rls": None, "force": None, "policies": {},
                                  "has_woreda_id_col": has_woreda, "woreda_id_not_null": wnn,
                                  "grants": [], "ddl": s[:4000]})
            events.append((loc, "create_table", t))
            continue
        m = re.match(rf"ALTER TABLE (?:IF EXISTS )?(?:ONLY )?({QID}) (.*)", s, re.I)
        if m:
            t = norm(m.group(1))
            rest = m.group(2).upper()
            if m.group(1).lower().startswith("storage."):
                continue
            tb = tables.setdefault(t, {"created": None, "rls": None, "force": None, "policies": {},
                                       "has_woreda_id_col": False, "woreda_id_not_null": False, "grants": [], "ddl": ""})
            if "ENABLE ROW LEVEL SECURITY" in rest:
                tb["rls"] = loc
            if "DISABLE ROW LEVEL SECURITY" in rest:
                tb["rls"] = None
                events.append((loc, "DISABLE_RLS", t))
            if "NO FORCE ROW LEVEL SECURITY" in rest:
                tb["force"] = None
            elif "FORCE ROW LEVEL SECURITY" in rest:
                tb["force"] = loc
            if re.search(r"ADD COLUMN (IF NOT EXISTS )?WOREDA_ID\b", rest):
                tb["has_woreda_id_col"] = True
            if re.search(r"ALTER COLUMN WOREDA_ID SET NOT NULL", rest):
                tb["woreda_id_not_null"] = True
            continue
        m = re.match(rf"CREATE POLICY ({ID}) ON ({QID})(.*)", s, re.I)
        if m:
            pname = m.group(1).strip('"')
            tfull = m.group(2)
            rest = m.group(3)
            cmd = "ALL"
            mm = re.search(r"\bFOR (ALL|SELECT|INSERT|UPDATE|DELETE)\b", rest, re.I)
            if mm:
                cmd = mm.group(1).upper()
            roles = "public"
            mm = re.search(r"\bTO ((?:\w+\s*,\s*)*\w+)", rest, re.I)
            if mm:
                roles = mm.group(1).lower().replace(" ", "")
            restrictive = bool(re.search(r"AS RESTRICTIVE", rest, re.I))
            using = wcheck = None
            k = re.search(r"\bUSING\s*\(", rest, re.I)
            if k:
                using, _ = extract_paren(rest, k.end() - 1)
            k = re.search(r"\bWITH CHECK\s*\(", rest, re.I)
            if k:
                wcheck, _ = extract_paren(rest, k.end() - 1)
            pol = {"name": pname, "cmd": cmd, "roles": roles, "restrictive": restrictive,
                   "using": using, "with_check": wcheck, "loc": loc}
            if tfull.lower().startswith("storage."):
                storage_policies[(norm(tfull.split(".")[-1]), pname)] = pol
            else:
                t = norm(tfull)
                tb = tables.setdefault(t, {"created": None, "rls": None, "force": None, "policies": {},
                                           "has_woreda_id_col": False, "woreda_id_not_null": False, "grants": [], "ddl": ""})
                tb["policies"][pname] = pol
            continue
        m = re.match(rf"DROP POLICY (?:IF EXISTS )?({ID}) ON ({QID})", s, re.I)
        if m:
            pname = m.group(1).strip('"')
            tfull = m.group(2)
            if tfull.lower().startswith("storage."):
                storage_policies.pop((norm(tfull.split(".")[-1]), pname), None)
            else:
                t = norm(tfull)
                if t in tables:
                    tables[t]["policies"].pop(pname, None)
            events.append((loc, "drop_policy", f"{tfull}.{pname}"))
            continue
        m = re.match(rf"ALTER POLICY ({ID}) ON ({QID})(.*)", s, re.I)
        if m:
            events.append((loc, "ALTER_POLICY(manual review)", s[:200]))
            continue
        # VIEWS
        m = re.match(rf"CREATE (?:OR REPLACE )?VIEW ({QID})(.*)", s, re.I)
        if m:
            v = norm(m.group(1))
            rest = m.group(2)
            si = bool(re.search(r"security_invoker\s*=\s*(true|on)", rest[:300], re.I)) or \
                 bool(re.search(r"WITH\s*\(\s*security_invoker\s*\)", rest[:300], re.I))
            prev = views.get(v, {})
            views[v] = {"loc": loc, "security_invoker_at_create": si,
                        "security_invoker": si, "si_loc": loc if si else None,
                        "created_first": prev.get("created_first", loc),
                        "body": s[:6000]}
            continue
        m = re.match(rf"ALTER VIEW (?:IF EXISTS )?({QID}) SET \((.*)\)", s, re.I)
        if m:
            v = norm(m.group(1))
            if v in views and re.search(r"security_invoker\s*=\s*(true|on)", m.group(2), re.I):
                views[v]["security_invoker"] = True
                views[v]["si_loc"] = loc
            elif v in views and re.search(r"security_invoker\s*=\s*(false|off)", m.group(2), re.I):
                views[v]["security_invoker"] = False
                views[v]["si_loc"] = loc
            continue
        m = re.match(rf"DROP VIEW (?:IF EXISTS )?({QID})", s, re.I)
        if m:
            views.pop(norm(m.group(1)), None)
            events.append((loc, "drop_view", m.group(1)))
            continue
        # FUNCTIONS
        m = re.match(rf"CREATE (?:OR REPLACE )?FUNCTION ({QID})\s*\(", s, re.I)
        if m:
            f = norm(m.group(1))
            args, endp = extract_paren(s, m.end() - 1)
            # header = everything except the body: remove dollar-quoted body
            header = re.sub(r"\$([A-Za-z_]*)\$.*?\$\1\$", "$BODY$", s, flags=re.S)
            definer = bool(re.search(r"\bSECURITY DEFINER\b", header, re.I))
            sp = re.search(r"SET search_path\s*(?:=|TO)\s*([^\s]+(?:\s*,\s*[^\s]+)*?)(?=\s+(?:AS|LANGUAGE|SECURITY|STABLE|IMMUTABLE|VOLATILE|RETURNS|STRICT|PARALLEL|SET|COST|\$BODY\$)|$)", header, re.I)
            lang = re.search(r"LANGUAGE\s+(\w+)", header, re.I)
            rec = {"name": f, "args": " ".join(args.split()), "loc": loc, "definer": definer,
                   "search_path": sp.group(1) if sp else None, "language": lang.group(1) if lang else None,
                   "body": s}
            key = f
            functions[key] = rec  # latest by name (overloads noted in hist)
            func_hist[key].append({"loc": loc, "args": rec["args"], "definer": definer,
                                   "search_path": rec["search_path"]})
            continue
        m = re.match(rf"ALTER FUNCTION ({QID})\s*\((.*?)\)\s*(.*)", s, re.I)
        if m:
            f = norm(m.group(1))
            rest = m.group(3)
            if f in functions:
                sp = re.search(r"SET search_path\s*(?:=|TO)\s*(.+)$", rest, re.I)
                if sp:
                    functions[f]["search_path"] = sp.group(1).strip()
                    functions[f]["sp_altered"] = loc
                if re.search(r"SECURITY INVOKER", rest, re.I):
                    functions[f]["definer"] = False
                    functions[f]["definer_altered"] = loc
                if re.search(r"SECURITY DEFINER", rest, re.I):
                    functions[f]["definer"] = True
                    functions[f]["definer_altered"] = loc
            events.append((loc, "alter_function", s[:200]))
            continue
        m = re.match(rf"DROP FUNCTION (?:IF EXISTS )?({QID})", s, re.I)
        if m:
            events.append((loc, "drop_function", s[:200]))
            f = norm(m.group(1))
            func_hist[f].append({"loc": loc, "dropped": True})
            continue
        # GRANT / REVOKE
        if re.match(r"(GRANT|REVOKE)\b", s, re.I):
            grants.append({"loc": loc, "stmt": s[:400]})
            mm = re.search(rf"\bON (?:TABLE )?({QID}(?:\s*,\s*{QID})*) (?:TO|FROM)", s, re.I)
            if mm and not re.search(r"\bON (FUNCTION|SEQUENCE|SCHEMA|ALL)", s, re.I):
                for tn in mm.group(1).split(","):
                    t = norm(tn)
                    if t in tables:
                        tables[t]["grants"].append({"loc": loc, "stmt": s[:300]})
                    if t in views:
                        views[t].setdefault("grants", []).append({"loc": loc, "stmt": s[:300]})
            continue
        m = re.match(rf"CREATE (?:OR REPLACE )?(?:CONSTRAINT )?TRIGGER ({ID}) (.*?) ON ({QID}) (.*)", s, re.I)
        if m:
            fn = re.search(rf"EXECUTE (?:FUNCTION|PROCEDURE) ({QID})", s, re.I)
            triggers[(norm(m.group(3)), m.group(1).strip('"'))] = {
                "timing": m.group(2), "fn": norm(fn.group(1)) if fn else None, "loc": loc}
            continue
        m = re.match(rf"DROP TRIGGER (?:IF EXISTS )?({ID}) ON ({QID})", s, re.I)
        if m:
            triggers.pop((norm(m.group(2)), m.group(1).strip('"')), None)
            continue
        m = re.match(rf"CREATE SEQUENCE (?:IF NOT EXISTS )?({QID})", s, re.I)
        if m:
            sequences.append({"name": norm(m.group(1)), "loc": loc})
            continue
        if re.match(r"INSERT INTO storage\.buckets", s, re.I):
            buckets.append({"loc": loc, "stmt": s[:600]})
            continue
        if re.match(r"(UPDATE storage\.buckets)", s, re.I):
            buckets.append({"loc": loc, "stmt": s[:600]})
            continue
        if re.match(r"DO\b", s, re.I) and re.search(r"POLICY|ROW LEVEL|GRANT|REVOKE|security_invoker", s, re.I):
            events.append((loc, "DO_block_touching_security(manual review)", s[:160]))

# ---------- Reports ----------
def dump(name, obj):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=1, default=str)

rep = []
rep.append("# audit-database: RLS inventory reconstructed from migrations (latest state)\n")
rep.append(f"Migrations parsed: {len(MIG)}; public tables: {len(tables)}; views: {len(views)}; functions (distinct names): {len(functions)}\n")
rep.append("\n## Tables\n")
rep.append("table | created | RLS | FORCE | woreda_id col | NOT NULL | #pol | SELECT | INSERT | UPDATE | DELETE | ALL | roles | INS/UPD without WITH CHECK\n")
for t, d in sorted(tables.items()):
    cmds = collections.Counter(p["cmd"] for p in d["policies"].values())
    roles = sorted(set(p["roles"] for p in d["policies"].values()))
    nowc = [p["name"] for p in d["policies"].values() if p["cmd"] in ("INSERT", "UPDATE", "ALL") and p["with_check"] is None and not (p["cmd"] in ("UPDATE", "ALL") and p["using"])]
    rep.append(f"{t} | {d['created']} | {'Y '+d['rls'] if d['rls'] else 'NO'} | {'Y' if d['force'] else 'no'} | {d['has_woreda_id_col']} | {d['woreda_id_not_null']} | {len(d['policies'])} | {cmds['SELECT']} | {cmds['INSERT']} | {cmds['UPDATE']} | {cmds['DELETE']} | {cmds['ALL']} | {','.join(roles)} | {','.join(nowc)}\n")

rep.append("\n## Policies (latest), per table\n")
for t, d in sorted(tables.items()):
    rep.append(f"\n### {t}\n")
    for p in d["policies"].values():
        rep.append(f"- [{p['cmd']}] {p['name']} TO {p['roles']}{' RESTRICTIVE' if p['restrictive'] else ''} @ {p['loc']}\n    USING: {(' '.join((p['using'] or '').split()))[:600]}\n    CHECK: {(' '.join((p['with_check'] or '').split()))[:600]}\n")

rep.append("\n## Storage policies (storage.objects), latest\n")
for (t, pn), p in sorted(storage_policies.items()):
    rep.append(f"- [{p['cmd']}] {pn} TO {p['roles']} @ {p['loc']}\n    USING: {(' '.join((p['using'] or '').split()))[:600]}\n    CHECK: {(' '.join((p['with_check'] or '').split()))[:600]}\n")

rep.append("\n## Buckets\n")
for b in buckets:
    rep.append(f"- {b['loc']}: {b['stmt'][:400]}\n")

rep.append("\n## Views (latest)\n")
for v, d in sorted(views.items()):
    rep.append(f"- {v}: security_invoker={d['security_invoker']} (last CREATE {d['loc']}; si set at {d['si_loc']}) grants={[g['loc'] for g in d.get('grants', [])]}\n")

rep.append("\n## Functions (latest definition per name)\n")
rep.append("name | definer | search_path | lang | latest loc | #defs\n")
for f, d in sorted(functions.items()):
    rep.append(f"{f} | {d['definer']} | {d['search_path']} | {d['language']} | {d['loc']} | {len(func_hist[f])}\n")

rep.append("\n## SECURITY DEFINER functions WITHOUT pinned search_path (latest def)\n")
for f, d in sorted(functions.items()):
    if d["definer"] and not d["search_path"]:
        rep.append(f"- {f} @ {d['loc']}\n")

rep.append("\n## Triggers (latest)\n")
for (t, n), d in sorted(triggers.items()):
    rep.append(f"- {t}.{n}: {d['timing']} -> {d['fn']} @ {d['loc']}\n")

rep.append("\n## Sequences\n")
for s_ in sequences:
    rep.append(f"- {s_['name']} @ {s_['loc']}\n")

rep.append("\n## Grants/Revokes (chronological)\n")
for g in grants:
    rep.append(f"- {g['loc']}: {g['stmt']}\n")

rep.append("\n## Events needing manual review\n")
for e in events:
    if e[1] not in ("create_table",):
        rep.append(f"- {e[0]} {e[1]} {e[2]}\n")

open(os.path.join(OUT, "audit-database-rls-inventory.txt"), "w", encoding="utf-8").write("".join(rep))
dump("audit-database-catalog.json", {
    "tables": {t: {k: v for k, v in d.items() if k != "ddl"} for t, d in tables.items()},
    "views": {v: {k: x for k, x in d.items() if k != "body"} for v, d in views.items()},
    "functions": {f: {k: v for k, v in d.items() if k != "body"} for f, d in functions.items()},
    "function_history": func_hist,
    "triggers": {f"{t}.{n}": d for (t, n), d in triggers.items()},
    "storage_policies": {f"{t}.{n}": p for (t, n), p in storage_policies.items()},
    "buckets": buckets, "sequences": sequences,
})
# Save function bodies & table DDL for grep
with open(os.path.join(OUT, "audit-database-function-bodies.sql"), "w", encoding="utf-8") as fh:
    for f, d in sorted(functions.items()):
        fh.write(f"-- ===== {f} (latest @ {d['loc']}) =====\n{d['body']};\n\n")
with open(os.path.join(OUT, "audit-database-table-ddl.sql"), "w", encoding="utf-8") as fh:
    for t, d in sorted(tables.items()):
        fh.write(f"-- ===== {t} @ {d['created']} =====\n{d['ddl']};\n\n")
with open(os.path.join(OUT, "audit-database-view-bodies.sql"), "w", encoding="utf-8") as fh:
    for v, d in sorted(views.items()):
        fh.write(f"-- ===== {v} @ {d['loc']} =====\n{d['body']};\n\n")
print("ok", len(tables), len(views), len(functions), len(storage_policies), len(buckets))
