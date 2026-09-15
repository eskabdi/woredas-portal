import { invokeEdgeFunction } from "@/lib/edgeFunction";
import {
  CREDENTIAL_PUBLIC_KEY_PEM,
  CREDENTIAL_KEY_IMPORT_PARAMS,
  CREDENTIAL_SIGN_PARAMS,
} from "@/config/credentialCryptoConfig";

export interface HarariResidentProfile {
  credentialId: string;
  credentialNumber: string;
  serialNumber: string;
  woredaId: string;
  idNumber: string;
  fullNameAmharic: string;
  fullNameEnglish: string;
  genderAmharic: string;
  genderEnglish: "Male" | "Female";
  dobEthiopian: string;
  dobGregorian: string;
  woredaAmharic: string;
  woredaEnglish: string;
  kebeleAmharic: string;
  kebeleEnglish: string;
  houseNumber: string;
  photoUrl: string;
  issueDateEthiopian: string;
  issueDateGregorian: string;
  expiryDateEthiopian: string;
  expiryDateGregorian: string;
  placeOfIssueAmharic: string;
  placeOfIssueEnglish: string;
}

/**
 * The verified credential, expanded into readable field names for display.
 *
 * The token on the card carries a compact form with single-character keys — see
 * `CompactPayload` in the sign-credential function. This is what the scanner and
 * the public verification page work with after `verifyCredentialToken` expands it.
 *
 * There is deliberately no photo here. It used to be embedded as a 32x32
 * grayscale thumbnail, which is what pushed the printed QR past the density a
 * card printer can resolve. The photo is now fetched from storage by verifiers
 * who are entitled to see it.
 */
export interface HarariQRVerificationPayload {
  credentialNumber: string;
  idNumber: string;
  fullNameEnglish: string;
  gender: "Male" | "Female";
  dobGregorian: string;
  woreda: string;
  kebele: string;
  houseNumber: string;
  issueDate: string;
  expiryDate: string;
  placeOfIssue: string;
  iat: number;
}

/** The wire form: single-character keys, dates as YYYYMMDD. */
interface CompactPayload {
  c: string;
  i: string;
  n: string;
  g: "M" | "F";
  b: string;
  w: string;
  k: string;
  h: string;
  s: string;
  e: string;
  p: string;
  t: number;
}

/**
 * Asks the Edge Function to sign a credential.
 *
 * Only the identifiers travel: the function reads every signed field from the
 * database itself, so nothing a caller sends can end up inside the signature.
 */
export async function signCredentialPayload(
  credentialId: string,
  woredaId: string,
): Promise<string> {
  const { data, friendlyError } = await invokeEdgeFunction<{
    success?: boolean;
    token?: string;
  }>("sign-credential", { credentialId, woredaId });
  if (friendlyError) throw new Error(friendlyError);
  if (!data || data.success !== true) {
    throw new Error("sign-credential returned an unsuccessful response");
  }
  return data.token ?? "";
}

// --- Offline verification ---

function base64UrlDecodeToBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlDecodeToString(input: string): string {
  return new TextDecoder().decode(base64UrlDecodeToBytes(input));
}

/** "20260820" -> "2026-08-20". Passes anything else through untouched. */
function expandDate(d: string): string {
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

function expandPayload(c: CompactPayload): HarariQRVerificationPayload {
  return {
    credentialNumber: c.c ?? "",
    idNumber: c.i ?? "",
    fullNameEnglish: c.n ?? "",
    gender: c.g === "F" ? "Female" : "Male",
    dobGregorian: expandDate(c.b ?? ""),
    woreda: c.w ?? "",
    kebele: c.k ?? "",
    houseNumber: c.h ?? "",
    issueDate: expandDate(c.s ?? ""),
    expiryDate: expandDate(c.e ?? ""),
    placeOfIssue: c.p ?? "",
    iat: typeof c.t === "number" ? c.t : 0,
  };
}

/**
 * Pulls the token out of whatever the scanner produced.
 *
 * The QR on the card encodes a full verification URL so that any phone camera
 * lands on the public page, but the in-app scanner reads the same code and needs
 * the bare token. A token never contains "/", so the last path segment is safe
 * to take.
 */
export function extractToken(scanned: string): string {
  const s = scanned.trim();
  if (!/^https?:\/\//i.test(s)) return s;
  try {
    const segments = new URL(s).pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "";
  } catch {
    return s;
  }
}

async function importPublicKey(): Promise<CryptoKey> {
  const pem = CREDENTIAL_PUBLIC_KEY_PEM.replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(pem);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return crypto.subtle.importKey(
    "spki",
    der.buffer.slice(0) as ArrayBuffer,
    CREDENTIAL_KEY_IMPORT_PARAMS,
    false,
    ["verify"],
  );
}

/**
 * Verifies a credential token offline against the bundled public key.
 *
 * A valid signature proves the data was issued by the regional government and
 * has not been altered. It says nothing about whether the credential is still
 * current — a card revoked yesterday still carries a perfectly valid signature —
 * so anything acting on the result must also check live status.
 */
export async function verifyCredentialToken(scanned: string): Promise<{
  valid: boolean;
  payload: HarariQRVerificationPayload | null;
  error: string | null;
  expired: boolean;
}> {
  try {
    const token = extractToken(scanned);
    const parts = token.split(".");
    if (parts.length !== 2) {
      return { valid: false, payload: null, error: "Malformed token", expired: false };
    }
    const [p, s] = parts;
    const signingInput = new TextEncoder().encode(p);
    const signature = base64UrlDecodeToBytes(s);
    const key = await importPublicKey();
    const ok = await crypto.subtle.verify(
      CREDENTIAL_SIGN_PARAMS,
      key,
      signature.buffer.slice(
        signature.byteOffset,
        signature.byteOffset + signature.byteLength,
      ) as ArrayBuffer,
      signingInput.buffer.slice(
        signingInput.byteOffset,
        signingInput.byteOffset + signingInput.byteLength,
      ) as ArrayBuffer,
    );
    if (!ok) return { valid: false, payload: null, error: "Signature invalid", expired: false };

    let compact: CompactPayload;
    try {
      compact = JSON.parse(base64UrlDecodeToString(p)) as CompactPayload;
    } catch {
      return { valid: false, payload: null, error: "Payload not JSON", expired: false };
    }
    const payload = expandPayload(compact);

    let expired = false;
    if (payload.expiryDate) {
      const exp = new Date(payload.expiryDate);
      if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) expired = true;
    }
    return { valid: true, payload, error: null, expired };
  } catch (e) {
    return {
      valid: false,
      payload: null,
      error: (e as Error).message,
      expired: false,
    };
  }
}
