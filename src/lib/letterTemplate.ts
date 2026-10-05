/** Letter template tokens, HTML sanitisation and rendering helpers. */

export const LETTER_TOKENS: { token: string; labelAm: string; labelEn: string }[] = [
  { token: "{APPLICANT_NAME}", labelAm: "የአመልካች ስም", labelEn: "Applicant full name" },
  { token: "{RESIDENT_NUMBER}", labelAm: "የነዋሪ ቁጥር", labelEn: "Resident number" },
  { token: "{KEBELE}", labelAm: "ቀበሌ", labelEn: "Kebele" },
  { token: "{WOREDA}", labelAm: "ወረዳ", labelEn: "Woreda" },
  { token: "{PURPOSE}", labelAm: "ጉዳይ", labelEn: "Purpose / subject" },
  { token: "{ADDRESSED_TO}", labelAm: "ለ", labelEn: "Addressed to" },
  { token: "{LETTER_NO}", labelAm: "የደብዳቤ ቁጥር", labelEn: "Letter number" },
  { token: "{DATE_ET}", labelAm: "ቀን (ኢት.)", labelEn: "Date (Ethiopian)" },
  { token: "{DATE_GC}", labelAm: "ቀን (ግሪጎሪያን)", labelEn: "Date (Gregorian)" },
  { token: "{SEX}", labelAm: "ጾታ", labelEn: "Sex" },
  { token: "{DETAILS}", labelAm: "ዝርዝር", labelEn: "Request details" },
];

export const ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "DIV",
  "SPAN",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "SUB",
  "SUP",
  "H1",
  "H2",
  "H3",
  "H4",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "A",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TD",
  "TH",
  "HR",
]);

export const ALLOWED_ATTRS = new Set(["href", "target", "rel", "colspan", "rowspan"]);
export const ALLOWED_STYLES = new Set([
  "text-align",
  "font-weight",
  "font-style",
  "text-decoration",
]);

// Value rules shared, character for character, with letter_html_is_safe()
// in migration 93 (each pattern is valid as both a JS RegExp and a Postgres
// ARE). A test compares these strings against the SQL, so the client can
// never keep a value the server rejects and the server can never silently
// widen. A kept style declaration's value must be plain keywords/numbers,
// optionally with rgb()/hsl() colours: without that, an allowed property
// could carry `expression(...)`, `url(...)` or a CSS escape such as `\3b`.
export const LETTER_HREF_RE = "^(https?:|mailto:|tel:)";
export const LETTER_TOKEN_ATTR_RE = "^[A-Za-z0-9 _-]*$"; // target, rel
export const LETTER_SPAN_ATTR_RE = "^[0-9]{1,3}$"; // colspan, rowspan
export const LETTER_COLOUR_FN_RE = "(rgba?|hsla?)\\([0-9 .,%]*\\)";
export const LETTER_STYLE_VALUE_RE = "^[A-Za-z0-9 #%.,-]*$";

const HREF_RE = new RegExp(LETTER_HREF_RE, "i");
const TOKEN_ATTR_RE = new RegExp(LETTER_TOKEN_ATTR_RE);
const SPAN_ATTR_RE = new RegExp(LETTER_SPAN_ATTR_RE);
const COLOUR_FN_RE = new RegExp(LETTER_COLOUR_FN_RE, "gi");
const STYLE_VALUE_RE = new RegExp(LETTER_STYLE_VALUE_RE);

function isSafeStyleValue(value: string): boolean {
  return STYLE_VALUE_RE.test(value.replace(COLOUR_FN_RE, ""));
}

/** Same per-attribute value rule as the server; false means drop the attribute. */
function isAllowedAttrValue(name: string, value: string): boolean {
  if (name === "href") return HREF_RE.test(value);
  if (name === "target" || name === "rel") return TOKEN_ATTR_RE.test(value);
  if (name === "colspan" || name === "rowspan") return SPAN_ATTR_RE.test(value);
  return false;
}

function isAllowedDeclaration(decl: string): boolean {
  const colon = decl.indexOf(":");
  if (colon < 0) return false;
  const prop = decl.slice(0, colon).trim().toLowerCase();
  return ALLOWED_STYLES.has(prop) && isSafeStyleValue(decl.slice(colon + 1).trim());
}

// These tags' whole point is that their "text content" is not meant to be
// read as document text -- a <script> body is source code, a <style> body is
// CSS. The generic disallowed-tag path below unwraps to textContent (so a
// stray tag an editor produces by accident still keeps its visible words),
// which is correct for e.g. <font> or <center> but would leak an injected
// script's source as literal visible text in the rendered letter for these.
// Removed outright instead, content included.
const STRIP_ENTIRELY = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED"]);

/** Strips scripts, event handlers and unsafe URLs from editor/template HTML. */
export function sanitizeLetterHtml(html: string): string {
  if (!html) return "";
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    return html.replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  }
  // Parsed as a whole document and read back from <body>, not wrapped in a
  // <div>: inside a wrapper, a stray `</div>` in the input closes it early
  // and everything after it is silently dropped.
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.body;

  // Comments are inert here but carry nothing a letter needs, and Word/Chrome
  // paste adds them (<!--StartFragment-->). Removing them keeps every
  // sanitised value inside the server-side allow-list (migration 93), which
  // rejects any `<!`. The walk below only visits elements, so comments are
  // collected separately. 0x80 = NodeFilter.SHOW_COMMENT.
  const comments: Node[] = [];
  const tw = doc.createTreeWalker(root, 0x80);
  while (tw.nextNode()) comments.push(tw.currentNode);
  for (const c of comments) c.parentNode?.removeChild(c);

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (STRIP_ENTIRELY.has(child.tagName)) {
        child.remove();
        continue;
      }
      if (!ALLOWED_TAGS.has(child.tagName)) {
        const text = doc.createTextNode(child.textContent ?? "");
        child.replaceWith(text);
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (name === "style") {
          const kept = attr.value
            .split(";")
            .map((d) => d.trim())
            .filter((d) => d && isAllowedDeclaration(d))
            .join("; ");
          if (kept) child.setAttribute("style", kept);
          else child.removeAttribute("style");
          continue;
        }
        if (!ALLOWED_ATTRS.has(name) || !isAllowedAttrValue(name, attr.value)) {
          child.removeAttribute(attr.name);
        }
      }
      if (child.tagName === "A") {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
      walk(child);
    }
  };

  walk(root);
  return root.innerHTML;
}

/** Plain text of an HTML letter body (used for summaries and CSV/PDF export). */
export function letterHtmlToText(html: string): string {
  if (!html) return "";
  const withBreaks = html.replace(/<\/(p|div|h[1-4]|li|tr)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
  const text =
    typeof window !== "undefined" && typeof window.DOMParser !== "undefined"
      ? (new DOMParser().parseFromString(withBreaks, "text/html").body.textContent ?? "")
      : withBreaks.replace(/<[^>]*>/g, "");
  return text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Short one-paragraph summary shown on the public verification page. */
export function letterSummary(html: string, max = 400): string {
  const text = letterHtmlToText(html).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Replaces {TOKEN} placeholders inside an HTML template with escaped values. */
export function renderLetterTemplate(
  templateHtml: string,
  values: Record<string, string | null | undefined>,
): string {
  let out = templateHtml;
  for (const [key, raw] of Object.entries(values)) {
    out = out.replaceAll(`{${key}}`, escapeHtml(raw ?? "—"));
  }
  return out;
}

/** Converts a legacy plain-text template into simple HTML paragraphs. */
export function plainTextToHtml(text: string): string {
  if (!text.trim()) return "";
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
