-- ============================================================================
-- Storage inventory: every stored object, with its path, size and type.
--
-- Run in the Supabase SQL Editor against the OLD project.
--
-- This lists files; it cannot export them. Supabase keeps object bytes in
-- S3-backed storage, and storage.objects holds only metadata, so no query can
-- return the file contents. Moving the bytes needs the Storage API --
-- see scripts/migrate-storage.mjs.
--
-- Two things this is good for: seeing the scope of what has to move (how many
-- files, how much data, which tenants), and verifying afterwards that the new
-- project ended up with the same inventory.
--
-- The first result set is a per-bucket summary; the second lists every object.
-- The SQL Editor shows one result at a time, so run the sections separately if
-- it only returns the last one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Summary: per bucket, and per woreda within each bucket.
--    The first path segment is the woreda id, which is what
--    storage_path_woreda_id() reads and what the RLS policies match on.
-- ---------------------------------------------------------------------------
SELECT
  o.bucket_id,
  split_part(o.name, '/', 1)                              AS woreda_prefix,
  count(*)                                                AS files,
  pg_size_pretty(sum((o.metadata->>'size')::bigint))      AS total_size,
  min(o.created_at)::date                                 AS oldest,
  max(o.created_at)::date                                 AS newest
FROM storage.objects o
GROUP BY ROLLUP (o.bucket_id, split_part(o.name, '/', 1))
ORDER BY o.bucket_id NULLS LAST, woreda_prefix NULLS LAST;


-- ---------------------------------------------------------------------------
-- 2. Full object list. This is the manifest to check the new project against.
-- ---------------------------------------------------------------------------
SELECT
  o.bucket_id
    || '/' || o.name
    || '  |  ' || COALESCE(o.metadata->>'size', '?') || ' bytes'
    || '  |  ' || COALESCE(o.metadata->>'mimetype', 'unknown')
    AS object
FROM storage.objects o
ORDER BY o.bucket_id, o.name;
