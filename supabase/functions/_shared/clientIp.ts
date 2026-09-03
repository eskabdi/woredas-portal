// Best-effort client IP for audit_log.source_ip (a column that existed in
// the baseline schema but was never populated by any function until INSA
// remediation Phase B).
//
// INFORMATIONAL ONLY. Even the platform-attested headers below are not a
// security control -- the rate limiter keys on the verified caller user_id
// for exactly that reason. This value's job is to give the audit trail one
// more investigative signal, not to be one on its own.
//
// Header order matters: cf-connecting-ip/x-real-ip are set by the edge
// platform itself and a client cannot overwrite them, whereas
// x-forwarded-for's *first* hop is whatever the client sent -- the platform
// only appends the real address after it. Checking XFF first would let any
// caller that can reach the function directly write an arbitrary string
// into their own audit row. Prefer the attested headers; fall back to XFF's
// first hop only when neither is present.
export function getClientIp(req: Request): string | null {
  const attested = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
  if (attested) return attested;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}
