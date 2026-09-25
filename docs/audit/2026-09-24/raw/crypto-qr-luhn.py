# Port of public.luhn_check_digit (supabase/migrations/00000000000002_credential.sql:22-47)
def luhn_sql(d):
    s=0
    for i in range(1,len(d)+1):
        v=int(d[len(d)-i])
        if i%2==1:
            v*=2
            if v>9: v-=9
        s+=v
    return (10-(s%10))%10
# Independent reference validator: a full number is valid iff standard Luhn sum % 10 == 0
def luhn_valid(full):
    s=0
    for i,ch in enumerate(reversed(full)):
        v=int(ch)
        if i%2==1:
            v*=2
            if v>9: v-=9
        s+=v
    return s%10==0
vec=[("01","01","26",1),("01","05","26",127),("02","19","26",999999),("06","12","25",42),("99","99","99",999999),("01","00","00",0),("03","07","26",500),("04","11","26",1)]
print("| # | Woreda | Kebele | YY | NNNNNN | 12-digit body | Luhn C | Stored credential_number | serial_number | Reference validator |")
print("|---|---|---|---|---|---|---|---|---|---|")
for n,(w,k,y,seq) in enumerate(vec,1):
    body=f"{w}{k}{y}{seq:06d}"
    c=luhn_sql(body)
    print(f"| {n} | {w} | {k} | {y} | {seq:06d} | {body} | {c} | {w}-{k}-{y}-{seq:06d}-{c} | {body} | {'valid' if luhn_valid(body+str(c)) else 'INVALID'} |")
# canonical textbook vector
print("textbook 7992739871 ->", luhn_sql("7992739871"), "(expected 3)")
# detection checks on vector 2
body="010526000127"; full=body+str(luhn_sql(body))
single=sum(1 for i in range(13) for d in "0123456789" if d!=full[i] and luhn_valid(full[:i]+d+full[i+1:]))
print("single-digit substitutions undetected:", single, "of", 13*9)
trans=[(i,full[i],full[i+1]) for i in range(12) if full[i]!=full[i+1] and luhn_valid(full[:i]+full[i+1]+full[i]+full[i+2:])]
print("adjacent transpositions undetected in this number:", trans)
print("09<->90 example:", luhn_valid("0000000000"+"09"+str(luhn_sql("0"*10+"09"))[0:0]) )
b="010526000090"; f=b+str(luhn_sql(b)); t=f[:10]+"09"+f[12:]
print("body 010526000090 C=",luhn_sql(b)," full",f," swapped",t," swapped valid?",luhn_valid(t))
