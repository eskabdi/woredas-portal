/**
 * Security headers for every response the SSR server produces.
 *
 * Applied in src/server.ts, the one chokepoint every document response passes
 * through — vercel.json headers are not reliable here because nitro emits its
 * own Build Output routes, and route-level meta tags cannot set HSTS or
 * frame-ancestors at all. Static assets served directly by the CDN bypass this
 * file; the headers that matter (CSP, HSTS, frame protections) only act on
 * documents, which all come from here.
 *
 * See docs/security-hardening.md for the full plan this implements, including
 * the pieces that live in the Vercel/Supabase dashboards rather than in code.
 */

/**
 * The Supabase project origin, for connect-src/img-src. Read from the server
 * env at runtime so the policy follows the project the build actually talks
 * to. The wildcard fallback only applies when the env is missing (e.g. a bare
 * local `node .output/server`), and still confines connections to Supabase.
 */
function supabaseOrigin(): string {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const m = url.match(/^https:\/\/[a-z0-9-]+\.supabase\.(co|com)/);
  return m ? m[0] : "https://*.supabase.co";
}

/**
 * Content-Security-Policy.
 *
 * script-src carries 'unsafe-inline' deliberately: TanStack Start's SSR emits
 * two inline scripts (the $tsr stream barrier and the scroll-restoration
 * snippet), so 'self' alone breaks hydration. The CSP still blocks loading
 * script *files* from any foreign origin, plus object/base/form/frame hijacks
 * — the common injection paths after XSS. Upgrading to nonces (dropping
 * 'unsafe-inline') requires threading a per-request nonce through TanStack
 * Start's shell rendering; do that as its own change, verified against a real
 * login, print flow, and QR scan.
 *
 * Origin inventory this encodes (keep in sync when adding an integration):
 * - fonts.googleapis.com / fonts.gstatic.com — Noto Sans Ethiopic + Inter
 * - *.tile.openstreetmap.org — Leaflet base map tiles (img only)
 * - the Supabase project origin — REST/auth/storage/functions (connect),
 *   signed storage URLs (img), realtime (wss, unused today but harmless)
 * - data:/blob: images — QR canvas, Code 128 barcode, WebP conversion previews
 * - blob: workers — html5-qrcode camera scanning
 * - frame-src 'self' — react-to-print renders into a same-origin iframe
 */
function contentSecurityPolicy(): string {
  const supabase = supabaseOrigin();
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: https://*.tile.openstreetmap.org ${supabase}`,
    `connect-src 'self' ${supabase} ${supabase.replace("https://", "wss://")}`,
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Returns a response equal to `response` with the security headers set.
 * Header objects on responses that crossed the server entry can be immutable,
 * so this always rebuilds rather than mutating in place.
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  // Two years, subdomains included. Vercel serves HTTPS-only already; HSTS
  // closes the first-visit downgrade window. 'preload' is left off until the
  // domain owner submits to hstspreload.org — preloading is hard to undo.
  headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // SAMEORIGIN, not DENY: react-to-print stages the card in a same-origin
  // iframe. CSP frame-ancestors 'self' is the modern equivalent; this header
  // covers older engines.
  headers.set("X-Frame-Options", "SAMEORIGIN");
  // camera: html5-qrcode ID verification scanner. geolocation: Leaflet
  // location picker. Everything else this app never uses is denied outright.
  headers.set(
    "Permissions-Policy",
    "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), " +
      "magnetometer=(), gyroscope=(), accelerometer=()",
  );

  // CSP only on documents. Assets and JSON cannot execute a policy, and
  // stamping it everywhere makes violation debugging noisier.
  const contentType = headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    headers.set("Content-Security-Policy", contentSecurityPolicy());
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
