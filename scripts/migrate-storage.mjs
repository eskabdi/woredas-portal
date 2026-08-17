#!/usr/bin/env node
/**
 * Copies stored files from one Supabase project's storage to another.
 *
 * The schema, policies and buckets are handled by the migrations; this moves
 * the objects themselves, which nothing else covers.
 *
 * Object paths are preserved exactly. That matters: the storage policies
 * derive the owning woreda from the path prefix via storage_path_woreda_id(),
 * so a file copied to a different path becomes invisible to its own tenant.
 *
 * Usage:
 *   SRC_URL=https://<old-ref>.supabase.co \
 *   SRC_SERVICE_KEY=<old service_role key> \
 *   DST_URL=https://<new-ref>.supabase.co \
 *   DST_SERVICE_KEY=<new service_role key> \
 *   bun run scripts/migrate-storage.mjs [--dry-run] [--bucket <name>]
 *
 * Service role keys are required: they bypass RLS, which is what lets the
 * script read every tenant's objects. Pass them in the environment and do not
 * commit them.
 *
 * Re-runnable. Objects already present at the destination with the same size
 * are skipped, so an interrupted run can simply be repeated.
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ONLY_BUCKET = args.includes("--bucket")
  ? args[args.indexOf("--bucket") + 1]
  : null;

const { SRC_URL, SRC_SERVICE_KEY, DST_URL, DST_SERVICE_KEY } = process.env;

const missing = Object.entries({ SRC_URL, SRC_SERVICE_KEY, DST_URL, DST_SERVICE_KEY })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing environment variable(s): ${missing.join(", ")}`);
  process.exit(1);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const src = createClient(SRC_URL, SRC_SERVICE_KEY, opts);
const dst = createClient(DST_URL, DST_SERVICE_KEY, opts);

/** Storage list() returns one directory level at a time and pages at 100. */
async function listAll(client, bucket, prefix = "") {
  const out = [];
  const PAGE = 100;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data?.length) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A row with no id is a folder placeholder, not an object.
      if (entry.id === null || entry.id === undefined) {
        out.push(...(await listAll(client, bucket, path)));
      } else {
        out.push({ path, size: entry.metadata?.size ?? null, type: entry.metadata?.mimetype });
      }
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function main() {
  const { data: srcBuckets, error: bErr } = await src.storage.listBuckets();
  if (bErr) throw new Error(`listing source buckets: ${bErr.message}`);

  const { data: dstBuckets } = await dst.storage.listBuckets();
  const dstNames = new Set((dstBuckets ?? []).map((b) => b.name));

  const buckets = srcBuckets
    .map((b) => b.name)
    .filter((n) => (ONLY_BUCKET ? n === ONLY_BUCKET : true));

  console.log(`source buckets: ${buckets.join(", ") || "(none)"}`);
  if (DRY_RUN) console.log("DRY RUN — nothing will be written\n");

  let copied = 0, skipped = 0, failed = 0, bytes = 0;

  for (const bucket of buckets) {
    if (!dstNames.has(bucket)) {
      console.log(`\n## ${bucket}\n   SKIPPED — bucket does not exist at destination.`);
      console.log(`   Apply supabase/migrations/00000000000001_storage.sql first.`);
      continue;
    }

    const objects = await listAll(src, bucket);
    console.log(`\n## ${bucket} — ${objects.length} object(s)`);

    const existing = new Map(
      (await listAll(dst, bucket)).map((o) => [o.path, o.size]),
    );

    for (const obj of objects) {
      if (existing.has(obj.path) && existing.get(obj.path) === obj.size) {
        skipped++;
        continue;
      }
      if (DRY_RUN) {
        console.log(`   would copy  ${obj.path} (${obj.size ?? "?"} bytes)`);
        copied++;
        continue;
      }

      const { data: blob, error: dErr } = await src.storage.from(bucket).download(obj.path);
      if (dErr) {
        console.log(`   FAILED download ${obj.path}: ${dErr.message}`);
        failed++;
        continue;
      }

      const body = Buffer.from(await blob.arrayBuffer());
      const { error: uErr } = await dst.storage.from(bucket).upload(obj.path, body, {
        contentType: obj.type || blob.type || "application/octet-stream",
        upsert: true,
      });
      if (uErr) {
        console.log(`   FAILED upload ${obj.path}: ${uErr.message}`);
        failed++;
        continue;
      }

      copied++;
      bytes += body.length;
      console.log(`   copied  ${obj.path} (${body.length} bytes)`);
    }
  }

  console.log(
    `\n=== copied ${copied}, skipped ${skipped}, failed ${failed}, ` +
      `${(bytes / 1024 / 1024).toFixed(2)} MB transferred ===`,
  );
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error("\nAborted:", e.message);
  process.exit(1);
});
