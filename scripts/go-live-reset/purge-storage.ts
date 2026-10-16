/**
 * Go-live reset, storage half: removes pilot/test files after reset.sql has
 * run. Deleting database rows does not delete Storage objects, and Supabase
 * blocks a direct DELETE on storage.objects, so this goes through the
 * Storage API with the service-role key.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/go-live-reset/purge-storage.ts
 *   ... bun scripts/go-live-reset/purge-storage.ts --apply
 *
 * Dry run by default. Prints counts per bucket only, never object names
 * (the repository is public and names carry woreda and record ids).
 *
 * Fails closed: a bucket missing from both lists below stops the run.
 */
import { createClient } from "@supabase/supabase-js";

/** Every object here is a pilot record (resident, request, rental files). */
const PURGE_ALL = [
  "attachments",
  "credential-request-documents",
  "rental-request-documents",
  "resident-clearance-letters",
  "resident-documents",
  "resident-photos",
  "service-request-documents",
];
/** Configuration: logos, stamps, signatures, template backgrounds. */
const KEEP = ["certificate-templates", "credential-templates", "tenant-assets"];
/** Staff photos and signatures: kept only for accounts that survive the reset. */
const STAFF = "staff-assets";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
const apply = process.argv.includes("--apply");
const sb = createClient(url, key, { auth: { persistSession: false } });

async function listAll(bucket: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${bucket}: ${error.message}`);
    for (const e of data ?? []) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      // Folders come back without an id.
      if (e.id === null) out.push(...(await listAll(bucket, path)));
      else out.push(path);
    }
    if (!data || data.length < 1000) return out;
  }
}

async function remove(bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { data, error } = await sb.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) throw new Error(`remove ${bucket}: ${error.message}`);
    if ((data?.length ?? 0) !== Math.min(100, paths.length - i)) {
      throw new Error(`remove ${bucket}: fewer objects removed than requested`);
    }
  }
}

const { data: buckets, error: bErr } = await sb.storage.listBuckets();
if (bErr) throw new Error(`listBuckets: ${bErr.message}`);
const unknown = buckets
  .map((b) => b.id)
  .filter((id) => ![...PURGE_ALL, ...KEEP, STAFF].includes(id));
if (unknown.length)
  throw new Error(`Unclassified buckets, add them to a list first: ${unknown.join(", ")}`);

const { data: staff, error: sErr } = await sb.from("app_user").select("photo_path, signature_path");
if (sErr) throw new Error(`app_user: ${sErr.message}`);
const keepStaff = new Set(staff.flatMap((u) => [u.photo_path, u.signature_path]).filter(Boolean));

console.log(apply ? "APPLY: deleting" : "DRY RUN: nothing is deleted");
for (const bucket of [...PURGE_ALL, STAFF]) {
  const all = await listAll(bucket);
  const doomed = bucket === STAFF ? all.filter((p) => !keepStaff.has(p)) : all;
  if (apply && doomed.length) await remove(bucket, doomed);
  console.log(
    `${bucket}: ${doomed.length} of ${all.length} object(s) ${apply ? "removed" : "would be removed"}`,
  );
}
for (const bucket of KEEP) console.log(`${bucket}: kept`);
