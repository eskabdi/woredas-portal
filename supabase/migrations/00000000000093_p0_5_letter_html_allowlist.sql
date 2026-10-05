-- P0-5 / WP-APP-001 (security audit 2026-09-24): server-side allow-list for
-- service_type.letter_body_html.
--
-- The letter template is authored as HTML in Settings and rendered into the
-- editor, the preview, the print surface and the issued-letter snapshot.
-- The browser sanitises it (src/lib/letterTemplate.ts, sanitizeLetterHtml)
-- before saving, but nothing on the server stopped a direct PostgREST PATCH
-- by anyone holding tenant.manage from storing <img onerror=...>, which the
-- editor then assigned to a live contentEditable element: stored XSS against
-- the next administrator to open the tab.
--
-- This trigger REJECTS (does not rewrite) any value that is not made only of:
--   * text with no '<' (the browser serialises a literal '<' as &lt;), and
--   * tags from the same allow-list the client sanitiser keeps
--     (p br div span strong b em i u s sub sup h1-h4 ul ol li blockquote a
--     table thead tbody tr td th hr), with
--   * only the attributes it keeps: href (https:, http:, mailto:, tel: only),
--     target, rel, colspan, rowspan, style (text-align, font-weight,
--     font-style, text-decoration; plain values, rgb()/hsl() colours only).
-- Anything else -- comments, <!DOCTYPE, CDATA, on* handlers, other
-- attributes, other tags, '/'-separated attributes, entity-encoded schemes,
-- url()/expression() in CSS -- fails. The client sanitiser's output always
-- passes (it removes comments since this change; see the test suite), so
-- an honest save through the editor never hits this.
--
-- Rejecting instead of rewriting keeps the check small enough to reason
-- about: a validator only has to be conservative, not a complete HTML
-- parser. Where this tokenizer and a browser could disagree, the value is
-- rejected rather than accepted.
--
-- Revised in place on 2026-09-27, after code review and before it had been
-- applied to any database: shared value-rule constants, a linear-time tag
-- pattern and a 50 KB cap.
--
-- Additive only: two new functions and a new trigger (CREATE OR REPLACE).
-- Rolling back = CREATE OR REPLACE public.letter_html_is_safe to RETURN true.

CREATE OR REPLACE FUNCTION public.letter_html_is_safe(_html text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  -- One start or end tag. Attribute values: double-quoted, single-quoted or
  -- unquoted (HTML's unquoted-value character set). Attributes must be
  -- separated by whitespace; a '/'-separated attribute (<a/onclick=..>) does
  -- not match, leaves a '<' behind and so fails. Attribute names exclude
  -- '<' so a failed match stops at the next '<' instead of rescanning the
  -- rest of the string (keeps the work linear on hostile input).
  c_tag  CONSTANT text := '<(/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[^\s"''>/=<]+(?:\s*=\s*(?:"[^"]*"|''[^'']*''|[^\s"''=<>`]+))?)*)\s*/?>';
  c_attr CONSTANT text := '\s+([^\s"''>/=<]+)(?:\s*=\s*("[^"]*"|''[^'']*''|[^\s"''=<>`]+))?';
  -- The lists and value rules below must equal the ALLOWED_* sets and
  -- LETTER_*_RE constants in src/lib/letterTemplate.ts, character for
  -- character; src/lib/__tests__/letterTemplate.test.ts compares them.
  c_tags CONSTANT text[] := ARRAY['p','br','div','span','strong','b','em','i','u','s','sub','sup',
                                  'h1','h2','h3','h4','ul','ol','li','blockquote','a',
                                  'table','thead','tbody','tr','td','th','hr'];
  c_attrs CONSTANT text[] := ARRAY['href','target','rel','colspan','rowspan','style'];
  c_styles CONSTANT text[] := ARRAY['text-align','font-weight','font-style','text-decoration'];
  c_href_re CONSTANT text := '^(https?:|mailto:|tel:)';
  c_token_attr_re CONSTANT text := '^[A-Za-z0-9 _-]*$';
  c_span_attr_re CONSTANT text := '^[0-9]{1,3}$';
  c_colour_fn_re CONSTANT text := '(rgba?|hsla?)\([0-9 .,%]*\)';
  c_style_value_re CONSTANT text := '^[A-Za-z0-9 #%.,-]*$';
  c_max_len CONSTANT int := 50000;          -- production's longest template is ~500 chars
  t text[];
  a text[];
  v_name text;
  v_val text;
  v_decl text;
  v_prop text;
  v_css text;
BEGIN
  IF _html IS NULL OR _html = '' THEN
    RETURN true;
  END IF;
  IF length(_html) > c_max_len THEN
    RETURN false;
  END IF;

  FOR t IN SELECT regexp_matches(_html, c_tag, 'g') LOOP
    IF NOT (lower(t[2]) = ANY (c_tags)) THEN
      RETURN false;
    END IF;
    IF t[1] = '/' AND btrim(t[3]) <> '' THEN
      RETURN false;                         -- attributes on an end tag
    END IF;

    FOR a IN SELECT regexp_matches(t[3], c_attr, 'g') LOOP
      v_name := lower(a[1]);
      v_val := a[2];
      IF v_val LIKE '"%"' OR v_val LIKE '''%''' THEN
        v_val := substr(v_val, 2, length(v_val) - 2);
      END IF;
      v_val := coalesce(v_val, '');

      IF NOT (v_name = ANY (c_attrs)) THEN
        RETURN false;                       -- any other attribute (on*, src, id, ...)
      ELSIF v_name = 'href' THEN
        IF v_val !~* c_href_re THEN
          RETURN false;
        END IF;
      ELSIF v_name IN ('target', 'rel') THEN
        IF v_val !~ c_token_attr_re THEN
          RETURN false;
        END IF;
      ELSIF v_name IN ('colspan', 'rowspan') THEN
        IF v_val !~ c_span_attr_re THEN
          RETURN false;
        END IF;
      ELSE                                  -- style
        FOREACH v_decl IN ARRAY string_to_array(v_val, ';') LOOP
          CONTINUE WHEN btrim(v_decl) = '';
          v_prop := lower(btrim(split_part(v_decl, ':', 1)));
          v_css := btrim(substr(v_decl, strpos(v_decl, ':') + 1));
          IF strpos(v_decl, ':') = 0 OR NOT (v_prop = ANY (c_styles)) THEN
            RETURN false;
          END IF;
          -- Colour functions only; then plain keywords/numbers. No '&', no
          -- '\', no quotes, no url()/expression()/var().
          IF regexp_replace(v_css, c_colour_fn_re, '', 'gi') !~ c_style_value_re THEN
            RETURN false;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- Every '<' must have been the start of an allowed, well-formed tag.
  RETURN strpos(regexp_replace(_html, c_tag, '', 'g'), '<') = 0;
END;
$$;

COMMENT ON FUNCTION public.letter_html_is_safe(text) IS
  'P0-5/WP-APP-001: true iff the HTML uses only the letter-template allow-list (same as sanitizeLetterHtml in src/lib/letterTemplate.ts). Conservative: rejects anything it cannot classify.';

CREATE OR REPLACE FUNCTION public.enforce_letter_html_allowlist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.letter_body_html IS NOT NULL AND NOT public.letter_html_is_safe(NEW.letter_body_html) THEN
    RAISE EXCEPTION 'letter_body_html contains markup outside the letter allow-list'
      USING ERRCODE = '22023',
            HINT = 'Save the template through Settings > Letter templates, which sanitises it.';
  END IF;
  RETURN NEW;
END;
$$;

-- Only fires when letter_body_html is actually written, so unrelated
-- service_type updates (fees, names, is_active) are never blocked by a row
-- saved before this migration.
CREATE OR REPLACE TRIGGER trg_service_type_letter_html_allowlist
  BEFORE INSERT OR UPDATE OF letter_body_html ON public.service_type
  FOR EACH ROW EXECUTE FUNCTION public.enforce_letter_html_allowlist();

-- Not a public RPC: no anonymous caller needs it. The trigger function is
-- SECURITY INVOKER, so the saving user (authenticated) must keep EXECUTE on
-- the validator.
REVOKE EXECUTE ON FUNCTION public.letter_html_is_safe(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.letter_html_is_safe(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.enforce_letter_html_allowlist() FROM PUBLIC, anon, authenticated;
