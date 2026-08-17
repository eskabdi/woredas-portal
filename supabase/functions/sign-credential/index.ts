// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface HarariQRVerificationPayload {
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

interface RequestBody {
  payload: HarariQRVerificationPayload;
  credentialId: string;
  woredaId: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlEncodeString(s: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(s));
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hasControlChars(v: unknown): boolean {
  if (typeof v !== "string") return false;
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(v);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const PRIVATE_KEY_PEM = Deno.env.get("HARARI_RSA_PRIVATE_KEY");
    if (!PRIVATE_KEY_PEM) return json(500, { error: "Signing key not configured" });

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json(401, { error: "Missing authorization" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json(401, { error: "Invalid session" });
    const callerId = userData.user.id;

    const body = (await req.json()) as RequestBody;
    if (!body?.payload || !body.credentialId || !body.woredaId) {
      return json(400, { error: "Missing fields" });
    }

    // Photo size check (only client-supplied field kept in the signed payload)
    if (
      typeof body.payload.photoBase64 === "string" &&
      body.payload.photoBase64.length > 2048
    ) {
      return json(400, { error: "Photo payload too large (max 2048 bytes)" });
    }
    if (hasControlChars(body.payload.photoBase64)) {
      return json(400, { error: "Illegal characters in field photoBase64" });
    }


    // Woreda match check
    const { data: appUser, error: auErr } = await admin
      .from("app_user")
      .select("woreda_id, role")
      .eq("user_id", callerId)
      .maybeSingle();
    if (auErr) return json(500, { error: "User lookup failed" });
    if (!appUser) return json(403, { error: "User not registered" });
    if (appUser.role !== "super_admin" && appUser.woreda_id !== body.woredaId) {
      return json(403, { error: "Woreda mismatch" });
    }

    // Fetch credential, verify preconditions
    const { data: cred, error: credErr } = await admin
      .from("residence_credential")
      .select(
        "credential_id, woreda_id, status, qr_payload, credential_number, issue_date, expiry_date, resident_id, issuing_kebele_id",
      )
      .eq("credential_id", body.credentialId)
      .maybeSingle();
    if (credErr) return json(500, { error: "Credential lookup failed" });
    if (!cred) return json(404, { error: "Credential not found" });
    if (cred.woreda_id !== body.woredaId) return json(403, { error: "Credential woreda mismatch" });
    if (cred.status !== "ready_to_print") {
      return json(409, { error: `Credential status is ${cred.status}, expected ready_to_print` });
    }
    if (cred.qr_payload) return json(409, { error: "Credential already signed" });

    // SECURITY: identity fields are rebuilt from the database, never trusted
    // from the client. Only the compressed photo comes from the request.
    const { data: resident, error: resErr } = await admin
      .from("resident")
      .select("resident_number, national_id_no, full_name, sex, date_of_birth, current_household_id")
      .eq("resident_id", cred.resident_id)
      .maybeSingle();
    if (resErr) return json(500, { error: "Resident lookup failed" });
    if (!resident) return json(404, { error: "Resident not found" });

    const { data: kebeleRow } = await admin
      .from("kebele")
      .select("kebele_name_en")
      .eq("kebele_id", cred.issuing_kebele_id)
      .maybeSingle();

    const { data: woredaRow } = await admin
      .from("woreda")
      .select("woreda_name_en")
      .eq("woreda_id", cred.woreda_id)
      .maybeSingle();

    let houseNumber = "";
    if (resident.current_household_id) {
      const { data: hh } = await admin
        .from("household")
        .select("house_number")
        .eq("household_id", resident.current_household_id)
        .maybeSingle();
      houseNumber = hh?.house_number ?? "";
    }

    const verifiedPayload: HarariQRVerificationPayload = {
      idNumber: resident.national_id_no || resident.resident_number || "",
      fullNameEnglish: resident.full_name ?? "",
      gender: resident.sex === "female" ? "Female" : "Male",
      dobGregorian: resident.date_of_birth ?? "",
      woreda: woredaRow?.woreda_name_en ?? "",
      kebele: kebeleRow?.kebele_name_en ?? "",
      houseNumber,
      photoBase64: typeof body.payload.photoBase64 === "string" ? body.payload.photoBase64 : "",
      issueDate: cred.issue_date ?? new Date().toISOString().slice(0, 10),
      expiryDate: cred.expiry_date ?? "",
      placeOfIssue: woredaRow?.woreda_name_en ?? "",
      iss: "HARARI_REGIONAL_GOVERNMENT",
      iat: Math.floor(Date.now() / 1000),
      credentialNumber: cred.credential_number,
    };


    // Import RSA private key
    const der = pemToDer(PRIVATE_KEY_PEM);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const header = { alg: "RS256", typ: "JWT" };
    const headerB64 = base64UrlEncodeString(JSON.stringify(header));
    const payloadJson = JSON.stringify(verifiedPayload);
    const payloadB64 = base64UrlEncodeString(payloadJson);
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sig = new Uint8Array(
      await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        key,
        signingInput.buffer.slice(signingInput.byteOffset, signingInput.byteOffset + signingInput.byteLength) as ArrayBuffer,
      ),
    );
    const token = `${headerB64}.${payloadB64}.${base64UrlEncodeBytes(sig)}`;

    // Persist token
    const { error: updErr } = await admin
      .from("residence_credential")
      .update({ qr_payload: token })
      .eq("credential_id", body.credentialId);
    if (updErr) return json(500, { error: `Failed to store token: ${updErr.message}` });

    await admin.from("audit_log").insert({
      woreda_id: body.woredaId,
      actor_user_id: callerId,
      entity_name: "residence_credential",
      entity_id: body.credentialId,
      action_type: "QR_SIGNED",
      new_value_json: { credential_number: cred.credential_number } as any,
      action_at: new Date().toISOString(),
    } as any);

    return json(200, { success: true, token });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
