import { describe, expect, it } from "vitest";
import {
  letterHtmlToText,
  letterSummary,
  plainTextToHtml,
  renderLetterTemplate,
  sanitizeLetterHtml,
} from "@/lib/letterTemplate";

describe("sanitizeLetterHtml", () => {
  it("returns an empty string for empty input", () => {
    expect(sanitizeLetterHtml("")).toBe("");
  });

  it("keeps an allow-listed tag and its text content", () => {
    expect(sanitizeLetterHtml("<p>Hello</p>")).toBe("<p>Hello</p>");
  });

  it("strips a <script> tag entirely, keeping no trace of its content as markup", () => {
    const out = sanitizeLetterHtml("<p>before</p><script>alert(1)</script><p>after</p>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("unwraps a harmless disallowed tag but keeps its text content", () => {
    // <font> is not in ALLOWED_TAGS but carries no execution risk, so the
    // walk only replaces the element with a text node -- it doesn't delete
    // legitimate text an operator typed inside a tag the editor never
    // should have produced.
    expect(sanitizeLetterHtml("<font>kept text</font>")).toBe("kept text");
  });

  it("removes a <script>/<style>/<iframe>/<object> tag AND its content entirely, unlike a harmless disallowed tag", () => {
    // Regression: the generic disallowed-tag path unwraps to textContent,
    // which is right for <font> above but wrong here -- a <script> body is
    // source code, not document text, and unwrapping it would leak the
    // injected payload as literal visible text in the rendered letter
    // instead of removing it.
    for (const tag of ["script", "style", "iframe", "object"]) {
      const out = sanitizeLetterHtml(`<p>before</p><${tag}>alert(1)</${tag}><p>after</p>`);
      expect(out).not.toContain("alert(1)");
      expect(out).toBe("<p>before</p><p>after</p>");
    }
  });

  it("removes a stray <embed> element (a void tag, so it can carry no text content of its own)", () => {
    // <embed> is void/self-closing in HTML parsing -- `<embed>x</embed>`
    // parses as an empty <embed> followed by sibling text "x" and a stray,
    // ignored closing tag, never as <embed> containing "x". The element
    // itself (and any src it might otherwise carry) is still removed.
    const out = sanitizeLetterHtml('<p>before</p><embed src="evil"><p>after</p>');
    expect(out).not.toContain("<embed");
    expect(out).not.toContain("src=");
  });

  it("strips an inline event handler attribute from an allowed tag", () => {
    const out = sanitizeLetterHtml('<p onclick="alert(1)">click me</p>');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("click me");
  });

  it("strips a javascript: URL from an <a href>", () => {
    const out = sanitizeLetterHtml('<a href="javascript:alert(1)">link</a>');
    expect(out).not.toContain("javascript:");
  });

  it("keeps an http(s)/mailto/tel href unchanged", () => {
    expect(sanitizeLetterHtml('<a href="https://example.com">x</a>')).toContain(
      'href="https://example.com"',
    );
    expect(sanitizeLetterHtml('<a href="mailto:a@b.com">x</a>')).toContain('href="mailto:a@b.com"');
    expect(sanitizeLetterHtml('<a href="tel:+251911234567">x</a>')).toContain(
      'href="tel:+251911234567"',
    );
  });

  it("forces target=_blank and rel=noopener noreferrer on every <a>, even one that tried to set its own", () => {
    const out = sanitizeLetterHtml(
      '<a href="https://example.com" target="_self" rel="opener">x</a>',
    );
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain('target="_self"');
  });

  it("drops an attribute not on the allow list", () => {
    const out = sanitizeLetterHtml('<p data-evil="1" title="also not allowed">x</p>');
    expect(out).not.toContain("data-evil");
    expect(out).not.toContain("title=");
  });

  it("keeps an allow-listed inline style property and drops the rest", () => {
    const out = sanitizeLetterHtml(
      '<p style="text-align: center; position: fixed; font-weight: bold;">x</p>',
    );
    expect(out).toContain("text-align: center");
    expect(out).toContain("font-weight: bold");
    expect(out).not.toContain("position");
  });

  it("removes the style attribute entirely when nothing in it survives the allow list", () => {
    const out = sanitizeLetterHtml('<p style="position: fixed;">x</p>');
    expect(out).not.toContain("style=");
  });

  it("recurses into nested allowed tags, sanitizing at every level", () => {
    const out = sanitizeLetterHtml('<div><p onclick="bad()">nested</p></div>');
    expect(out).not.toContain("onclick");
    expect(out).toContain("nested");
  });

  it("keeps table structure tags and colspan/rowspan", () => {
    const out = sanitizeLetterHtml('<table><tbody><tr><td colspan="2">x</td></tr></tbody></table>');
    expect(out).toContain("<table>");
    expect(out).toContain('colspan="2"');
  });
});

describe("letterHtmlToText", () => {
  it("returns an empty string for empty input", () => {
    expect(letterHtmlToText("")).toBe("");
  });

  it("turns block-level closing tags and <br> into newlines", () => {
    expect(letterHtmlToText("<p>line one</p><p>line two</p>")).toBe("line one\nline two");
    expect(letterHtmlToText("line one<br>line two")).toBe("line one\nline two");
  });

  it("collapses 3+ consecutive newlines to a blank line", () => {
    expect(letterHtmlToText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });

  it("strips remaining tags and decodes entities via the DOM", () => {
    expect(letterHtmlToText("<p>a &amp; b</p>")).toBe("a & b");
  });
});

describe("letterSummary", () => {
  it("returns the full text unchanged when under the max length", () => {
    expect(letterSummary("<p>short</p>", 400)).toBe("short");
  });

  it("truncates with an ellipsis when over the max length", () => {
    const long = "x".repeat(500);
    const out = letterSummary(`<p>${long}</p>`, 400);
    expect(out.length).toBe(400);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("renderLetterTemplate", () => {
  it("replaces a {TOKEN} placeholder with its value", () => {
    expect(renderLetterTemplate("Dear {APPLICANT_NAME},", { APPLICANT_NAME: "Abebe" })).toBe(
      "Dear Abebe,",
    );
  });

  it("HTML-escapes the substituted value, closing the token-injection XSS path", () => {
    const out = renderLetterTemplate("{DETAILS}", {
      DETAILS: "<script>alert(1)</script>",
    });
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("escapes double quotes, so a substituted value can't break out of an attribute", () => {
    const out = renderLetterTemplate('<a title="{PURPOSE}">x</a>', {
      PURPOSE: '" onmouseover="alert(1)',
    });
    expect(out).not.toContain('onmouseover="alert(1)"');
    expect(out).toContain("&quot;");
  });

  it("falls back to an em dash for a null/undefined value", () => {
    expect(renderLetterTemplate("{PURPOSE}", { PURPOSE: null })).toBe("—");
    expect(renderLetterTemplate("{PURPOSE}", { PURPOSE: undefined })).toBe("—");
  });

  it("replaces every occurrence of a repeated token", () => {
    expect(renderLetterTemplate("{X} and {X}", { X: "a" })).toBe("a and a");
  });
});

describe("plainTextToHtml", () => {
  it("returns an empty string for whitespace-only input", () => {
    expect(plainTextToHtml("   ")).toBe("");
  });

  it("wraps each blank-line-separated block in its own <p>", () => {
    expect(plainTextToHtml("first\n\nsecond")).toBe("<p>first</p><p>second</p>");
  });

  it("turns a single newline within a block into <br>", () => {
    expect(plainTextToHtml("line one\nline two")).toBe("<p>line one<br>line two</p>");
  });

  it("escapes HTML-significant characters in the source text", () => {
    expect(plainTextToHtml("<script>alert(1)</script>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
  });
});
