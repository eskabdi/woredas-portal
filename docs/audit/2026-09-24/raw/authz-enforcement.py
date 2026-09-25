import re,json,glob,collections
R='/home/user/woredas-portal'
A=R+'/docs/audit/2026-09-24/raw/'
d=json.load(open('/tmp/claude-0/-home-user-woredas-portal/c732feb8-e299-512b-97aa-5b903a5d4787/scratchpad/matrix.json'))
keys=list(d['P'].values())
inv=open(A+'audit-database-rls-inventory.txt').read()
pol=inv.split('## Policies (latest), per table')[1].split('## Buckets')[0]
# policies: parse table + cmd + name + text
enf=collections.defaultdict(set)
table=None
for block in re.split(r'\n(?=### |- \[)',pol):
    m=re.match(r'### (\S+)',block)
    if m: table=m.group(1); continue
    m=re.match(r'- \[(\w+)\] (\S+)',block)
    if not m: continue
    cmd,name=m.groups()
    for k in keys:
        if re.search(r"[{'\",]"+re.escape(k)+r"[}'\",]",block) and 'permission_key <> ALL' not in block:
            enf[k].add(f"RLS {table}.{cmd}")
fb=open(A+'audit-database-function-bodies.sql').read()
for sec in re.split(r'\n(?=-- ===== )',fb):
    m=re.match(r'-- ===== (\w+) ',sec)
    if not m: continue
    fn=m.group(1)
    if fn in ('default_role_perms','seed_role_permission_for_new_woreda'): continue
    for k in keys:
        if re.search(r"[{'\",]"+re.escape(k)+r"[}'\",]",sec):
            enf[k].add(f"fn {fn}()")
# workflow transitions
wt=set()
for f in sorted(glob.glob(R+'/supabase/migrations/*.sql')):
    s=re.sub(r'--[^\n]*','',open(f).read())
    for m in re.finditer(r"\(\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'([a-z_.]+)'\s*,\s*(true|false)\s*(?:,\s*'LEGACY-28)?",s):
        if 'LEGACY-28' in m.group(0): continue
        wt.add(m.groups()[:4])
for e,fr,to,k in wt:
    if k in keys: enf[k].add(f"FSM {e}")
# edge
for f in glob.glob(R+'/supabase/functions/*/index.ts'):
    s=open(f).read()
    for k in keys:
        if re.search(r'["\']'+re.escape(k)+r'["\']',s): enf[k].add('edge '+f.split('/')[-2])
out={k:sorted(enf[k]) for k in keys}
json.dump(out,open('/tmp/claude-0/-home-user-woredas-portal/c732feb8-e299-512b-97aa-5b903a5d4787/scratchpad/enf.json','w'),indent=1)
for k in keys: print(k.ljust(28),len(out[k]),'; '.join(out[k])[:230])
