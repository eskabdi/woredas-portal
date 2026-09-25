// Reproduces the repo's signer (sign-credential/index.ts:35-43, 221-245) and verifier
// (src/utils/harariCredentialCrypto.ts:100-107, 178-205) with a THROWAWAY key.
function b64uBytes(bytes: Uint8Array): string { let bin=""; for (const b of bytes) bin+=String.fromCharCode(b); return btoa(bin).replace(/=+$/g,"").replace(/\+/g,"-").replace(/\//g,"_"); }
function b64uStr(s: string) { return b64uBytes(new TextEncoder().encode(s)); }
function b64uDecode(input: string): Uint8Array { const pad = input.length%4===0?"":"=".repeat(4-(input.length%4)); const b64=input.replace(/-/g,"+").replace(/_/g,"/")+pad; const bin=atob(b64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
const kp = await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"}, true, ["sign","verify"]);
const payload = { c:"0105260000127", i:"HR-01-000123", n:"Abdulahi Mohammed Yusuf", g:"M", b:"19900115", w:"Aboker", k:"Kebele 05", h:"1234/B", s:"20260920", e:"20270920", p:"Aboker Woreda Administration", t:1790000000 };
const p = b64uStr(JSON.stringify(payload));
const sig = new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"}, kp.privateKey, new TextEncoder().encode(p)));
const s = b64uBytes(sig);
const token = `${p}.${s}`;
async function verify(tok: string) { const [pp, ss] = tok.split("."); return crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"}, kp.publicKey, b64uDecode(ss), new TextEncoder().encode(pp)); }
console.log("payload JSON bytes:", JSON.stringify(payload).length, " token chars:", token.length, " sig chars:", s.length);
console.log("URL chars (https://woredas-portal.vercel.app/v/ + token):", ("https://woredas-portal.vercel.app/v/"+token).length);
console.log("original verifies:", await verify(token));
// (1) Trailing-bit malleability of base64url: 64 bytes -> 86 chars, last char carries 4 unused bits.
const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const last = s[s.length-1]; const idx = alpha.indexOf(last); let variants = 0;
for (let j=0;j<64;j++){ if (j===idx) continue; const t2 = `${p}.${s.slice(0,-1)}${alpha[j]}`; if (await verify(t2)) variants++; }
console.log("distinct last-char variants that still verify:", variants);
// (2) ECDSA (r, n-s) malleability.
const n = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");
const r = sig.slice(0,32); const sBig = BigInt("0x"+Buffer.from(sig.slice(32)).toString("hex"));
const s2 = (n - sBig).toString(16).padStart(64,"0");
const sig2 = new Uint8Array([...r, ...Buffer.from(s2,"hex")]);
const token2 = `${p}.${b64uBytes(sig2)}`;
console.log("(r, n-s) token differs:", token2!==token, " verifies:", await verify(token2));
// PII readable without any key:
console.log("decoded without key:", new TextDecoder().decode(b64uDecode(p)));
