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

const ALLOWED_TAGS = new Set([
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

const ALLOWED_ATTRS = new Set(["href", "target", "rel", "colspan", "rowspan"]);
const ALLOWED_STYLES = new Set(["text-align", "font-weight", "font-style", "text-decoration"]);

/** Strips scripts, event handlers and unsafe URLs from editor/template HTML. */
export function sanitizeLetterHtml(html: string): string {
  if (!html) return "";
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    return html.replace(/<\/?(script|style|iframe|object|embed)[^>]*>/gi, "");
  }
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
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
            .filter((d) => d && ALLOWED_STYLES.has(d.split(":")[0]!.trim().toLowerCase()))
            .join("; ");
          if (kept) child.setAttribute("style", kept);
          else child.removeAttribute("style");
          continue;
        }
        if (!ALLOWED_ATTRS.has(name)) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (name === "href" && !/^(https?:|mailto:|tel:)/i.test(attr.value)) {
          child.removeAttribute("href");
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
    .replace(/"/g, "&quot;");
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
