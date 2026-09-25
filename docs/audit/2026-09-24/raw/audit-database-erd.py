#!/usr/bin/env python3
"""Generate architecture/erd.md (Mermaid erDiagram) from migrations + types.ts. Read-only on the app."""
import re, glob, json, collections
t = open("src/integrations/supabase/types.ts").read()
p = t[t.find("\n  public: {"):]
tabs = p[p.find("    Tables: {"):p.find("    Views: {")]
cols = collections.OrderedDict()
for m in re.finditer(r"^      ([a-z_0-9]+): \{\n        Row: \{\n(.*?)\n        \}", tabs, re.M | re.S):
    cols[m.group(1)] = re.findall(r"^          ([a-z_0-9]+)\??: ([^\n]+)", m.group(2), re.M)
# SQL types
sqlt = {}
for f in sorted(glob.glob("supabase/migrations/*.sql")):
    s = re.sub(r"--[^\n]*", "", open(f).read())
    for m in re.finditer(r"CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_0-9]+)\s*\((.*?)\n\);", s, re.S | re.I):
        for line in m.group(2).split("\n"):
            mm = re.match(r"\s*([a-z_][a-z_0-9]*)\s+(timestamp with time zone|double precision|character varying|[a-z_0-9]+(?:\(\d+(?:,\d+)?\))?(?:\[\])?)", line, re.I)
            if mm and mm.group(1).upper() not in ("CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"):
                sqlt[(m.group(1), mm.group(1))] = mm.group(2)
    for m in re.finditer(r"ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\.)?([a-z_0-9]+)\s+(.*?);", s, re.S | re.I):
        for mm in re.finditer(r"ADD COLUMN (?:IF NOT EXISTS )?([a-z_0-9]+)\s+(timestamp with time zone|double precision|[a-z_0-9]+(?:\(\d+(?:,\d+)?\))?(?:\[\])?)", m.group(2), re.I):
            sqlt[(m.group(1), mm.group(1))] = mm.group(2)
# PKs
pks = collections.defaultdict(set)
for f in sorted(glob.glob("supabase/migrations/*.sql")):
    s = re.sub(r"--[^\n]*", "", open(f).read())
    for m in re.finditer(r"ALTER TABLE (?:ONLY )?(?:public\.)?([a-z_0-9]+) ADD CONSTRAINT \w+ PRIMARY KEY \(([^)]+)\)", s, re.I):
        for c in m.group(2).split(","): pks[m.group(1)].add(c.strip())
    for m in re.finditer(r"CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_0-9]+)\s*\((.*?)\n\);", s, re.S | re.I):
        for line in m.group(2).split("\n"):
            mm = re.match(r"\s*([a-z_0-9]+)\s+\w+.*\bPRIMARY KEY\b", line, re.I)
            if mm: pks[m.group(1)].add(mm.group(1))
            mm = re.match(r"\s*(?:CONSTRAINT \w+ )?PRIMARY KEY \(([^)]+)\)", line.strip(), re.I)
            if mm:
                for c in mm.group(1).split(","): pks[m.group(1)].add(c.strip())
fks = json.load(open("docs/audit/2026-09-24/raw/audit-database-fks.json"))
fkcols = collections.defaultdict(set)
for x in fks: fkcols[x["table"]].add(x["col"])
SENS = {
 "resident": {"full_name":"PII name","full_name_am":"PII name","first_name":"PII name","father_name":"PII name","grandfather_name":"PII name","mother_full_name":"PII name","date_of_birth":"PII DOB","sex":"PII","marital_status":"PII","phone_number":"PII plaintext (enc copy in _enc)","phone_number_enc":"AES/pgp_sym","email":"PII plaintext (enc copy)","email_enc":"AES/pgp_sym","national_id_no":"RESTRICTED FAN/ID plaintext (enc copy)","national_id_no_enc":"AES/pgp_sym","photo_url":"biometric-adjacent photo path","ethnicity":"SPECIAL CATEGORY plaintext","religion":"SPECIAL CATEGORY plaintext","birth_place":"PII","work_info":"PII","former_residence":"PII","current_residence_extra":"PII address"},
 "household": {"phone_number":"PII plaintext (enc copy)","email":"PII plaintext (enc copy)","address_line":"PII address","gps_lat":"RESTRICTED GPS","gps_lng":"RESTRICTED GPS","rent_amount":"financial plaintext (enc copy)"},
 "household_location": {"gps_lat":"RESTRICTED GPS","gps_lng":"RESTRICTED GPS"},
 "service_request": {"applicant_name":"PII","applicant_phone":"PII plaintext (enc copy)","details":"PII free text","incident_place":"PII","issued_letter_html":"PII rendered","respondent_name":"PII","verification_token":"bearer token (public verify)"},
 "vital_event": {"event_details":"PII jsonb (parents, child, spouse, death)"},
 "payment": {"amount":"financial plaintext (enc copy)"},
 "receipt": {"verification_token":"bearer token (public verify)"},
 "residence_credential": {"qr_payload":"signed token (public verify)","issued_recipient_name":"PII"},
 "app_user": {"full_name":"staff PII","signature_path":"staff signature image"},
 "woreda_settings": {"supervisor_signature_url":"official signature image","stamp_url":"official stamp image"},
 "audit_log": {"source_ip":"IP address","old_value_json":"may embed PII","new_value_json":"may embed PII"},
 "credential_verification_log": {"source_ip":"IP address","attempted_value":"token/number probe"},
 "rental_occupancy": {"rent_amount":"financial plaintext (enc copy)"},
 "rental_occupancy_request": {"rent_amount":"financial plaintext (enc copy)"},
}
def mtype(tb, c, ts):
    v = sqlt.get((tb, c))
    if v: return re.sub(r"[^a-zA-Z0-9_]", "_", v.split("(")[0].replace(" ", "_"))
    return {"string": "text", "number": "numeric", "boolean": "boolean"}.get(ts.split(" ")[0].strip("|"), "jsonb")
lines = ["erDiagram"]
sens_list = []
for tb, cl in cols.items():
    lines.append(f"  {tb} {{")
    for c, ts in cl:
        keys = []
        if c in pks.get(tb, set()): keys.append("PK")
        if c in fkcols.get(tb, set()): keys.append("FK")
        sens = SENS.get(tb, {}).get(c)
        # keep entity readable: PK, FK, woreda_id, status, sensitive columns only
        if not (keys or c in ("woreda_id", "status") or sens): continue
        k = " " + ",".join(keys) if keys else ""
        cm = f' "SENSITIVE: {sens}"' if sens else ""
        lines.append(f"    {mtype(tb, c, ts)} {c}{k}{cm}")
        if sens: sens_list.append((tb, c, sens))
    lines.append("  }")
seen = set()
for x in fks:
    if x["ref"] == "users":
        continue
    key = (x["ref"], x["table"], x["col"])
    if key in seen: continue
    seen.add(key)
    lines.append(f'  {x["ref"]} ||--o{{ {x["table"]} : "{x["col"]}"')
for tb, c, s in sens_list:
    lines.insert(1, f"  %% SENSITIVE {tb}.{c} -- {s}")
open("docs/audit/2026-09-24/raw/audit-database-erd.mmd", "w").write("\n".join(lines) + "\n")
print(len(cols), "entities;", len(seen), "relationships;", len(sens_list), "sensitive columns")
