import re, json, glob, os, collections
R='/home/user/woredas-portal'
src=open(R+'/src/config/permissions.ts').read()
P=dict(re.findall(r'^\s+([A-Z_]+): "([a-z_.]+)",',src.split('export const P = {')[1].split('} as const')[0],re.M))
rp_block=src.split('export const ROLE_PERMISSIONS')[1].split('};')[0]
RP={}
for m in re.finditer(r'(\w+): \[(.*?)\]',rp_block,re.S):
    RP[m.group(1)]=[P[k] for k in re.findall(r'P\.([A-Z_]+)',m.group(2))]
mig=open(R+'/supabase/migrations/00000000000083_rental_phase5_checkpoint.sql').read()
fn=mig.split('CREATE OR REPLACE FUNCTION public.default_role_perms')[1].split('$function$;')[0]
DR={}
for m in re.finditer(r"WHEN '(\w+)' THEN ARRAY\[(.*?)\]",fn):
    DR[m.group(1)]=re.findall(r"'([a-z_.]+)'",m.group(2))
# drift ROLE_PERMISSIONS vs default_role_perms
drift=[]
for r in RP:
    a=set(RP[r]); b=set(DR.get(r,[]))
    if a!=b: drift.append((r,sorted(a-b),sorted(b-a)))
# seed rows
seed=open(R+'/supabase/seed.sql').read()
rows=re.findall(r"INSERT INTO public\.role_permission \(woreda_id, role_name, permission_key, is_granted[^)]*\) VALUES \('([0-9a-f-]+)', '(\w+)', '([a-z_.]+)', '(true|false)'",seed)
seedmap=collections.defaultdict(dict)
for w,r,k,g in rows: seedmap[(r,k)][w]=(g=='true')
seed_div=[]
for (r,k),ws in sorted(seedmap.items()):
    d = k in DR.get(r,[])
    vals=set(ws.values())
    if vals!={d}:
        seed_div.append((r,k,d,{w[:8]:v for w,v in ws.items()}))
seed_keys=set(k for (_,k) in seedmap)
# server references: all migration text (latest-agnostic, count any reference in policy/function/workflow)
alltxt=''
for f in sorted(glob.glob(R+'/supabase/migrations/*.sql')):
    alltxt+=open(f).read()
edge=''
for f in glob.glob(R+'/supabase/functions/*/index.ts'): edge+=open(f).read()
# strip SQL comments and default_role_perms arrays and role_permission insert VALUES
t=re.sub(r'--[^\n]*','',alltxt)
t=re.sub(r"CREATE OR REPLACE FUNCTION public\.default_role_perms.*?\$function\$\s*;",'',t,flags=re.S)
t=re.sub(r"RESERVED|permission_key <> ALL \(ARRAY\[.*?\]\)",'',t,flags=re.S)
t=re.sub(r"CHECK \(permission_key = ANY.*?\)\)",'',t,flags=re.S)
srcall=''
for f in glob.glob(R+'/src/**/*.ts*',recursive=True):
    if 'permissions.ts' in f or '__tests__' in f or 'types.ts' in f: continue
    srcall+=open(f).read()
out=[]
inv={v:k for k,v in P.items()}
for k,v in P.items():
    roles=[r for r in RP if v in RP[r]]
    server=len(re.findall(r"['\"{,]"+re.escape(v)+r"['\"},]",t))
    client=len(re.findall(r'P\.'+k+r'\b',srcall))
    out.append(dict(key=v,const=k,roles=roles,in_seed=v in seed_keys,server_refs=server,client_refs=client))
json.dump(dict(P=P,drift=drift,seed_divergence=seed_div,matrix=out),open('/tmp/claude-0/-home-user-woredas-portal/c732feb8-e299-512b-97aa-5b903a5d4787/scratchpad/matrix.json','w'),indent=1)
print('P keys',len(P),'roles',list(RP)); print('drift',drift)
print('seed rows',len(rows),'seed keys',len(seed_keys),'seed roles',sorted(set(r for r,_ in seedmap)))
print('seed divergences',len(seed_div))
for s in seed_div: print(' ',s[0],s[1],'default=',s[2],'seed=',set(s[3].values()))
print('--- no server refs')
for o in out:
    if o['server_refs']==0: print(' ',o['key'],o['roles'],'client',o['client_refs'])
print('--- no client refs')
for o in out:
    if o['client_refs']==0: print(' ',o['key'],'server',o['server_refs'])
print('keys not in seed:',[o['key'] for o in out if not o['in_seed']])
