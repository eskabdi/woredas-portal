// Best-effort client IP for audit_log.source_ip (a column that existed in
// the baseline schema but was never populated by any function until INSA
// remediation Phase B).
//
// INFORMATIONAL ONLY. x-forwarded-for is attacker-influenced for any caller
// that can reach the function directly, so this value must never gate a
// security decision -- the rate limiter keys on the verified caller
// user_id for exactly that reason. Its job is to give the audit trail one
// more investigative signal, not to be one on its own.
export function getClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
}
