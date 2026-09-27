import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { sanitizeLetterHtml } from "@/lib/letterTemplate";

import { RichTextEditor } from "../rich-text-editor";

// WP-APP-001 (security audit 2026-09-24): the editor assigns its value to a
// live contentEditable element's innerHTML, and that value comes straight
// from service_type.letter_body_html -- which a direct PostgREST PATCH can
// set to anything. Everything reaching that sink must pass the letter
// allow-list first.

const PAYLOAD =
  '<p>Hello</p><img src=x onerror="window.__xss=1">' +
  '<a href="javascript:alert(1)" onclick="alert(1)">link</a>' +
  "<script>window.__xss=2</script><svg onload=alert(1)></svg>";

function editable(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[contenteditable]");
  if (!el) throw new Error("editor surface not found");
  return el;
}

describe("RichTextEditor", () => {
  it("sanitises a stored value before it reaches the live DOM", () => {
    const { container } = render(
      <RichTextEditor value={PAYLOAD} onChange={vi.fn()} sanitize={sanitizeLetterHtml} />,
    );
    const el = editable(container);

    expect(el.querySelector("img, script, svg")).toBeNull();
    const all = Array.from(el.querySelectorAll("*"));
    for (const node of all) {
      for (const attr of Array.from(node.attributes)) {
        expect(attr.name.startsWith("on")).toBe(false);
      }
    }
    expect(el.querySelector("a")?.getAttribute("href")).toBeNull();
    expect(el.textContent).toContain("Hello");
  });

  it("sanitises a value swapped in later (switching letter types)", () => {
    const { container, rerender } = render(
      <RichTextEditor value="<p>first</p>" onChange={vi.fn()} sanitize={sanitizeLetterHtml} />,
    );
    rerender(<RichTextEditor value={PAYLOAD} onChange={vi.fn()} sanitize={sanitizeLetterHtml} />);
    const el = editable(container);
    expect(el.querySelector("img, script, svg")).toBeNull();
    expect(el.innerHTML).not.toContain("onerror");
  });

  it("does not reset the editor while the user types", () => {
    const { container, rerender } = render(
      <RichTextEditor value="<p>a</p>" onChange={vi.fn()} sanitize={sanitizeLetterHtml} />,
    );
    const el = editable(container);
    // execCommand can leave markup the allow-list later unwraps on save
    // (e.g. <font>); echoing it back as `value` must not rewrite the DOM,
    // or the caret would jump on every keystroke.
    el.innerHTML = '<p>a<font color="red">b</font></p>';
    const typed = el.innerHTML;
    rerender(<RichTextEditor value={typed} onChange={vi.fn()} sanitize={sanitizeLetterHtml} />);
    expect(el.innerHTML).toBe(typed);
  });

  it("resets to a new external value even when it differs only in stripped markup", () => {
    const { container, rerender } = render(
      <RichTextEditor value="<p>a</p>" onChange={vi.fn()} sanitize={sanitizeLetterHtml} />,
    );
    const el = editable(container);
    el.innerHTML = '<p>a</p><img src="x">'; // pasted, never saved
    rerender(<RichTextEditor value="<p>a</p> " onChange={vi.fn()} sanitize={sanitizeLetterHtml} />);
    expect(el.querySelector("img")).toBeNull();
  });
});
