"""Consolidate per-agent findings into 02-findings.json / 02-findings-register.md.

Applies the audit-verifier merges (duplicates folded into their canonical finding) and
severity/confidence verdicts. Re-runnable: python3 raw/build-register.py (cwd = audit folder).
"""
import json, glob, collections, os

os.chdir(os.path.dirname(os.path.abspath(__file__)) + "/..")
SEV = ["Critical", "High", "Medium", "Low", "Info"]
ver = json.load(open("findings/verifier.json"))

allf = {}
for f in sorted(glob.glob("findings/*.json")):
    j = json.load(open(f))
    agent = j.get("agent") or os.path.basename(f)[:-5]
    for x in j.get("findings", []):
        x = dict(x)
        x["reported_by"] = agent
        allf[x["id"]] = x

dup_to_canon = collections.defaultdict(list)
for m in ver["merges"]:
    for d in m["duplicates"]:
        dup_to_canon[d].append((m["canonical"], m["reason"]))

verd = {v["id"]: v for v in ver["verdicts"]}

out = {}
for fid, x in allf.items():
    if fid in dup_to_canon:
        continue
    x = dict(x)
    x.setdefault("merged_from", [])
    v = verd.get(fid)
    if v and v.get("canonical") == fid:
        x["severity"] = v["new_severity"]
        x["confidence"] = v.get("new_confidence", x.get("confidence"))
        x["verification"] = v["verdict"]
    elif x.get("severity") in ("Critical", "High"):
        x["verification"] = "verified"
    else:
        x["verification"] = "not individually re-verified (Medium sample FP rate 0/10)"
    out[fid] = x

for dup, canons in dup_to_canon.items():
    src = allf.get(dup)
    for canon, reason in canons:
        if canon not in out:
            continue
        c = out[canon]
        c["merged_from"].append(dup)
        if src:
            ev = src.get("evidence") or []
            c["evidence"] = (c.get("evidence") or []) + [dict(e, via=dup) for e in ev[:3] if isinstance(e, dict)]

for fid in list(out):
    v = verd.get(fid)
    if v and v["verdict"] == "needs-live-test":
        out[fid]["confidence"] = "Needs-live-verification"

order = {s: i for i, s in enumerate(SEV)}
final = sorted(out.values(), key=lambda x: (order.get(x.get("severity"), 9), x.get("module", ""), x["id"]))
json.dump({"generated": "2026-09-24", "baseline": "9950f16e426eedd586c6fd85f6c328d9923542d1",
           "counts": dict(collections.Counter(x["severity"] for x in final)), "findings": final},
          open("02-findings.json", "w"), ensure_ascii=False, indent=2)

def cell(s):
    s = s if isinstance(s, str) else json.dumps(s, ensure_ascii=False)
    return s.replace("\n", " ").strip()

cnt = collections.Counter(x["severity"] for x in final)
L = ["# 02 — Findings Register", "",
     "All findings after adversarial verification (`findings/verifier.md`) and de-duplication. "
     "Each entry lists the agent that reported it and any duplicate IDs merged into it. Raw per-agent "
     "findings remain in `findings/<agent>.md|.json`; the machine-readable register is `02-findings.json`.", "",
     "| Severity | Count |", "|---|---|"]
L += [f"| {s} | {cnt.get(s, 0)} |" for s in SEV]
L += [f"| **Total** | **{len(final)}** |", "",
      "Confidence: *Confirmed* = proven from code/migrations; *Likely* = strong evidence, exploit path needs one "
      "unverified assumption; *Needs-live-verification* = depends on live DB / dashboard state the audit could not read.", ""]

L += ["## Index (Critical and High)", "", "| ID | Severity | Module | Title | Confidence |", "|---|---|---|---|---|"]
for x in final:
    if x["severity"] in ("Critical", "High"):
        L.append(f"| [{x['id']}](#{x['id'].lower()}) | {x['severity']} | {x.get('module','')} | {cell(x['title'])} | {x.get('confidence','')} |")
L.append("")

bymod = collections.defaultdict(list)
for x in final:
    bymod[x.get("module") or "Platform"].append(x)
modorder = sorted(bymod, key=lambda m: (min(order.get(x["severity"], 9) for x in bymod[m]), m))
for m in modorder:
    L += [f"## Module: {m}", ""]
    for x in bymod[m]:
        L.append(f"### {x['id']}")
        L.append(f"**{cell(x['title'])}**  ")
        L.append(f"Severity **{x['severity']}** · Confidence {x.get('confidence','')} · Category {x.get('category','')} · "
                 f"Reported by `{x['reported_by']}` · Verification: {x.get('verification','')}"
                 + (f" · Merged: {', '.join(x['merged_from'])}" if x.get("merged_from") else ""))
        refs = x.get("refs") or {}
        rs = "; ".join(f"{k}: {', '.join(v) if isinstance(v, list) else v}" for k, v in refs.items() if v)
        if rs:
            L.append(f"  \nRefs: {rs}")
        L.append("")
        if x.get("cvss_v3_1"):
            L.append(f"- **CVSS:** {cell(x['cvss_v3_1'])}")
        ev = x.get("evidence") or []
        evs = []
        for e in ev[:6]:
            if isinstance(e, dict):
                loc = f"`{e.get('path','')}:{e.get('line','')}`" if e.get("path") else ""
                sn = cell(e.get("snippet", ""))[:160]
                evs.append(f"{loc} {('— `' + sn.replace('`', chr(39)) + '`') if sn else ''}".strip() + (f" (via {e['via']})" if e.get("via") else ""))
            else:
                evs.append(cell(e)[:200])
        if evs:
            L.append("- **Evidence:** " + "; ".join(evs))
        for k, lab in (("description", "Description"), ("attack_scenario", "Attack scenario"), ("impact", "Impact"), ("recommendation", "Recommendation")):
            if x.get(k):
                L.append(f"- **{lab}:** {cell(x[k])}")
        L.append(f"- **Effort:** {x.get('effort','')} · **Status:** {x.get('status','Open')}")
        L.append("")
open("02-findings-register.md", "w").write("\n".join(L) + "\n")
print(len(final), dict(cnt))
