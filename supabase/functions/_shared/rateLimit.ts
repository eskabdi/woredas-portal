// Fixed-window rate limiting backed by Postgres (rate_limit_bucket +
// rate_limit_hit(), migration 00000000000022). Edge Function isolates are
// stateless -- no memory survives across invocations and no Deno KV is
// provisioned for this project -- so the database is the one shared place a
// counter can live.
//
// FAIL-OPEN by design: if the RPC errors (table missing on an undeployed
// migration, transient DB failure), the request is allowed and the failure
// is logged. For an internal-staff app, a broken limiter must never take
// down invites; the limiter is a brake on abuse, not an availability
// dependency. Callers key buckets by the *verified* caller user_id, never
// by anything request-supplied (see getClientIp.ts for why IP is not a
// trustworthy key).

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function checkRateLimit(
  admin: RpcClient,
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean }> {
  try {
    const { data, error } = await admin.rpc("rate_limit_hit", {
      _bucket_key: bucketKey,
      _window_seconds: windowSeconds,
    });
    if (error) {
      console.error("rate_limit_hit failed (failing open):", error);
      return { allowed: true };
    }
    return { allowed: typeof data === "number" ? data <= limit : true };
  } catch (e) {
    console.error("rate_limit_hit threw (failing open):", e);
    return { allowed: true };
  }
}
