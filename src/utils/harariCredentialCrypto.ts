import { supabase } from "@/integrations/supabase/client";
import { CREDENTIAL_PUBLIC_KEY_PEM } from "@/config/credentialCryptoConfig";

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

export interface HarariQRVerificationPayload {
  idNumber: string;
  fullNameEnglish: string;
  gender: "Male" | "Female";
  dobGregorian: string;
  woreda: string;
  kebele: string;
  houseNumber: string;
  photoBase64: string;
  issueDate: string;
  expiryDate: string;
  placeOfIssue: string;
  iss: "HARARI_REGIONAL_GOVERNMENT";
  iat: number;
  credentialNumber: string;
}

export async function compressResidentPhoto(photoUrl: string): Promise<string> {
  if (!photoUrl) return "";
  try {
    const resp = await fetch(photoUrl);
    if (!resp.ok) return "";
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    // Iteratively shrink until the base64 fits well under the 2 KB signing budget.
    // Reserve ~600 bytes for the rest of the JSON payload → cap photo at ~1400 bytes.
    const PHOTO_BUDGET = 1400;
    const attempts: Array<{ size: number; quality: number }> = [
      { size: 64, quality: 0.25 },
      { size: 56, quality: 0.2 },
      { size: 48, quality: 0.2 },
      { size: 40, quality: 0.2 },
      { size: 32, quality: 0.2 },
    ];
    let last = "";
    for (const { size, quality } of attempts) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return "";
      ctx.filter = "grayscale(100%)";
      ctx.drawImage(bitmap, 0, 0, size, size);
      last = canvas.toDataURL("image/jpeg", quality);
      if (last.length <= PHOTO_BUDGET) return last;
    }
    return last;
  } catch {
    return "";
  }
}

export function buildQRPayload(
  profile: HarariResidentProfile,
  compressedPhotoBase64: string,
): HarariQRVerificationPayload {
  return {
    idNumber: profile.idNumber,
    fullNameEnglish: profile.fullNameEnglish,
    gender: profile.genderEnglish,
    dobGregorian: profile.dobGregorian,
    woreda: profile.woredaEnglish,
    kebele: profile.kebeleEnglish,
    houseNumber: profile.houseNumber,
    photoBase64: compressedPhotoBase64,
    issueDate: profile.issueDateGregorian,
    expiryDate: profile.expiryDateGregorian,
    placeOfIssue: profile.placeOfIssueEnglish,
    iss: "HARARI_REGIONAL_GOVERNMENT",
    iat: Math.floor(Date.now() / 1000),
    credentialNumber: profile.credentialNumber,
  };
}

export async function signCredentialPayload(
  payload: HarariQRVerificationPayload,
  credentialId: string,
  woredaId: string,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{
    success?: boolean;
    token?: string;
    error?: string;
  }>("sign-credential", {
    body: { payload, credentialId, woredaId },
  });
  if (error) throw new Error(error.message || "sign-credential invocation failed");
  if (!data || data.success !== true) {
    throw new Error(data?.error || "sign-credential returned unsuccessful response");
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
  const bytes = base64UrlDecodeToBytes(input);
  return new TextDecoder().decode(bytes);
}

async function importPublicKey(): Promise<CryptoKey> {
  const pem = CREDENTIAL_PUBLIC_KEY_PEM
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(pem);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return crypto.subtle.importKey(
    "spki",
    der.buffer.slice(0) as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export async function verifyCredentialToken(token: string): Promise<{
  valid: boolean;
  payload: HarariQRVerificationPayload | null;
  error: string | null;
  expired: boolean;
}> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { valid: false, payload: null, error: "Malformed token", expired: false };
    }
    const [h, p, s] = parts;
    const signingInput = new TextEncoder().encode(`${h}.${p}`);
    const signature = base64UrlDecodeToBytes(s);
    const key = await importPublicKey();
    const ok = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer,
      signingInput.buffer.slice(signingInput.byteOffset, signingInput.byteOffset + signingInput.byteLength) as ArrayBuffer,
    );
    if (!ok) return { valid: false, payload: null, error: "Signature invalid", expired: false };
    let payload: HarariQRVerificationPayload;
    try {
      payload = JSON.parse(base64UrlDecodeToString(p)) as HarariQRVerificationPayload;
    } catch {
      return { valid: false, payload: null, error: "Payload not JSON", expired: false };
    }
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
