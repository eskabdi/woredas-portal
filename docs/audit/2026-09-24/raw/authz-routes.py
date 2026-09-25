import re,glob,collections,json,os
R='/home/user/woredas-portal'
A=R+'/docs/audit/2026-09-24/raw/'
inv=open(A+'audit-database-rls-inventory.txt').read()
pol=inv.split('## Policies (latest), per table')[1].split('## Storage policies')[0]
cmdmap=collections.defaultdict(list)
table=None
for block in re.split(r'\n(?=### |- \[)',pol):
    m=re.match(r'### (\S+)',block)
    if m: table=m.group(1); continue
    m=re.match(r'- \[(\w+)\] (\S+)',block)
    if not m: continue
    cmd=m.group(1)
    body=block
    perms=sorted(set(re.findall(r"([a-z_]+\.[a-z_.]+)",re.sub(r"permission_key <> ALL \(ARRAY\[.*?\]\)","",body,flags=re.S))))
    perms=[p for p in perms if not p.startswith('public.') and '.sql' not in p and not p.endswith('_id') and p.count('.')>=1 and not re.match(r'(rc|cr|sr|tr|au|upo|trp|rp|tmc|st|h|r|p|d|live)\.',p)]
    tag=[]
    if 'is_tenant_admin' in body: tag.append('tenant_admin')
    if 'user_has_console_perm' in body: tag.append('console_perm')
    if 'get_user_woreda_id' in body: tag.append('woreda')
    if 'is_super_admin' in body and not tag: tag.append('super_admin')
    if 'USING: true' in body: tag.append('all-authenticated')
    ops=[cmd] if cmd!='ALL' else ['INSERT','UPDATE','DELETE','SELECT']
    for o in ops:
        cmdmap[(table,o)].append(('+'.join(tag))+(':'+','.join(perms) if perms else ''))
opmap={'insert':'INSERT','update':'UPDATE','upsert':'INSERT','delete':'DELETE'}
rows=[]
routes=sorted(glob.glob(R+'/src/routes/*.tsx'))
for f in routes:
    s=open(f).read(); name=os.path.basename(f)
    if not (name.startswith('woreda') or name.startswith('admin')): continue
    gates=sorted(set(re.findall(r'hasPermission\((P\.[A-Z_]+)\)',s))|set(re.findall(r'permission=\{(P\.[A-Z_]+)\}',s))|set(re.findall(r'(CP\.[A-Z_]+)',s)))
    page=sorted(set(re.findall(r'if \(!hasPermission\((P\.[A-Z_]+)\)\)',s)))
    mg=re.findall(r'moduleKey="([a-z_]+)"',s)
    w=collections.OrderedDict()
    for m in re.finditer(r'\.from\(\s*["\']([a-z_-]+)["\']\s*\)((?:\s|\n)*(?:as [^\n]*)?)\s*\.(insert|update|upsert|delete)\(',s):
        t=m.group(1); o=opmap[m.group(3)]
        w[f"{t}.{o}"]=' | '.join(cmdmap.get((t,o),['NO POLICY (denied)']))
    for m in re.finditer(r'storage\s*\.from\(\s*["\']([a-z-]+)["\']\s*\)\s*\.(upload|remove)',s):
        w[f"storage:{m.group(1)}.{m.group(2)}"]='woreda path prefix only (WP-DB-002)'
    for m in re.finditer(r'\.rpc\(\s*"([a-z_]+)"',s): w[f"rpc {m.group(1)}"]='see DB §7'
    rows.append(dict(route=name,gates=gates,page=page,module=mg,writes=w))
json.dump(rows,open('/tmp/claude-0/-home-user-woredas-portal/c732feb8-e299-512b-97aa-5b903a5d4787/scratchpad/routes.json','w'),indent=1)
for r in rows:
    print(r['route'],'| page:',r['page'],'| mod:',r['module'],'| gates:',len(r['gates']))
    for k,v in r['writes'].items(): print('   ',k,'=>',v[:150])
