import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Compact signed credential payload.
 *
 * Keys are single characters and dates are YYYYMMDD on purpose: every byte here
 * becomes QR modules, and the printed code has to stay coarse enough for a
 * 300 dpi card printer to resolve. See the card design notes before adding a
 * field — a payload that grows past ~500 characters pushes the QR into a version
 * the printer cannot render cleanly.
 */
interface CompactPayload {
  c: string; // credential number (13 digits)
  i: string; // resident number
  n: string; // full name (English)
  g: "M" | "F"; // gender
  b: string; // date of birth, YYYYMMDD
  w: string; // woreda
  k: string; // kebele
  h: string; // house number
  s: string; // issue date, YYYYMMDD
  e: string; // expiry date, YYYYMMDD
  p: string; // place of issue
  t: number; // issued at, unix seconds
}

interface RequestBody {
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

/** "2026-08-20" -> "20260820". Anything unparseable becomes "". */
function compactDate(d: string | null | undefined): string {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[1]}${m[2]}${m[3]}` : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const PRIVATE_KEY_PEM = Deno.env.get("HARARI_EC_PRIVATE_KEY");
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
    if (!body?.credentialId || !body.woredaId) {
      return json(400, { error: "Missing fields" });
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

    // SECURITY: every field in the signed payload is read from the database.
    // The request supplies only which credential to sign.
    const { data: resident, error: resErr } = await admin
      .from("resident")
      .select("resident_number, full_name, sex, date_of_birth, current_household_id")
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

    // The issuing entity's branded name can differ from the woreda's official
    // registry name — woreda_settings is where a tenant configures that. Falls
    // back to the registry name when nothing is configured.
    const { data: settingsRow } = await admin
      .from("woreda_settings")
      .select("woreda_name_display_en")
      .eq("woreda_id", cred.woreda_id)
      .maybeSingle();
    const placeOfIssue = settingsRow?.woreda_name_display_en || woredaRow?.woreda_name_en || "";

    let houseNumber = "";
    if (resident.current_household_id) {
      const { data: hh } = await admin
        .from("household")
        .select("house_number")
        .eq("household_id", resident.current_household_id)
        .maybeSingle();
      houseNumber = hh?.house_number ?? "";
    }

    const payload: CompactPayload = {
      c: (cred.credential_number ?? "").replace(/-/g, ""),
      i: resident.resident_number ?? "",
      n: resident.full_name ?? "",
      g: resident.sex === "female" ? "F" : "M",
      b: compactDate(resident.date_of_birth),
      w: woredaRow?.woreda_name_en ?? "",
      k: kebeleRow?.kebele_name_en ?? "",
      h: houseNumber,
      s: compactDate(cred.issue_date) || compactDate(new Date().toISOString().slice(0, 10)),
      e: compactDate(cred.expiry_date),
      p: placeOfIssue,
      t: Math.floor(Date.now() / 1000),
    };

    // ES256. The algorithm is pinned here rather than carried in a JWT header:
    // a header-supplied "alg" is what makes the classic alg:none forgery
    // possible, and both ends of this token are ours.
    const der = pemToDer(PRIVATE_KEY_PEM);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );

    const payloadB64 = base64UrlEncodeString(JSON.stringify(payload));
    const signingInput = new TextEncoder().encode(payloadB64);
    const sig = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        signingInput.buffer.slice(
          signingInput.byteOffset,
          signingInput.byteOffset + signingInput.byteLength,
        ) as ArrayBuffer,
      ),
    );
    const token = `${payloadB64}.${base64UrlEncodeBytes(sig)}`;

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
      new_value_json: { credential_number: cred.credential_number },
      action_at: new Date().toISOString(),
    });

    return json(200, { success: true, token });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
