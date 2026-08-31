# Markdown conventions for the woreda manual

`scripts/render-pdf.mjs` only understands the elements below — it's a
deliberately narrow parser, not a general Markdown engine, because the
manual only ever needs this subset and a narrow parser renders it
predictably every time. Writing outside this grammar won't throw an error;
it'll just fall through to a plain `<p>`, so a fenced code block or a nested
blockquote silently loses its intended styling. When in doubt, match the
worked example at the bottom of this file exactly.

## Headings → chapters and the table of contents

```
# 2. መግቢያ እና ዳሽቦርድ (Login & Dashboard)
## 2.2 መግቢያ (Login)
### 2.2.1 የመግቢያ ስህተቶች (Login Errors)
```

- `#` starts a new PDF page (chapter). Use it for top-level modules only.
- `##`/`###` are the screen- and subsection-level headings that appear in the
  rendered table of contents (levels 1-3 only; `####` doesn't appear in the
  TOC — use it for field-table-adjacent detail that doesn't need its own
  entry).
- Put the section number in the heading text itself (`2.2`, not just
  "Login") — the renderer doesn't auto-number, it just reads what you wrote.

## Screenshot placeholders — exact format, no variation

```
![ስክሪንሾት: መግቢያ ገጽ — /login]
(assets/screenshots/login.png)
```

- Line 1: `![ስክሪንሾት: <what's on screen, in Amharic> — <route path>]`
- Line 2 (optional but preferred): `(assets/screenshots/<slug>.png)` — a
  stable, human-guessable filename. If you omit line 2 the renderer still
  shows the placeholder box, just without a filename hint.
- The renderer turns this into a dashed-border placeholder box in the PDF
  showing the alt text and the path — it is never trying to load a real
  image (there isn't one yet), so don't worry about the path resolving.
- One screenshot placeholder per screen or per distinct state worth
  capturing (e.g. the form and its error state are two placeholders, not
  one) — see the worked example.

## Screenshot description and figure number — always a blockquote right after the image

```
> **ስክሪንሾት መግለጫ:** ይህ ገጽ የመግቢያ መስክ ይዟል። ...

> **ቁጥር:** 2.2-አ
```

Write the description as if the reader has never seen the app — name what's
in each region of the screen (top-left, center, below the fold), not just
"has a login form." The figure number matches the section number with an
Amharic letter suffix (አ, ብ, ሐ, ...) for multiple figures in one section.

## Callouts — also blockquotes, one per line, led by the emoji

```
> ❌ **ስህተት:** ልክ ያልሆነ ኢሜል ከገቡ "ልክ ያልሆነ ኢሜል" የሚለውን ስህተት ያገኛሉ።
> ⚠️ **ማስጠንቀቂያ:** የይለፍ ቃል ዝቅተኛ ርዝመት 8 ቁምፊ ነው።
> ✅ **ውጤት:** ወደ ዋና ዳሽቦርድ ይመራዎታል።
> 💡 **ምክር:** "አስታውስኝ" ሳጥን ከተመረጠ ኢሜሉ በራስ-ሰር ይሞላል።
```

The renderer detects the leading emoji and colors the line accordingly (red
for ❌, amber for ⚠️, green for ✅, blue for 💡). Only include the callouts
that are actually true of that screen — most screens don't have all four,
and inventing a warning or tip that doesn't apply just adds noise a real
user will learn to ignore.

## Step-by-step instructions

```
1. **ኢሜል መጻፍ** — የተመዘገቡበትን ኢሜል ያስገቡ።
   > ❌ **ስህተት:** ...
2. **መግባ ማጫን** — "መግባ" የሚለውን ይጫኑ።
   > ✅ **ውጤት:** ...
```

Ordinary numbered list, bold the action name, dash then the instruction. A
callout can follow a step as an indented blockquote line if it's specific to
that step rather than the screen as a whole — the renderer treats it as a
regular blockquote either way (indentation is for the source file's
readability, not something the parser depends on).

## Field reference tables

```
| ቁጥር | የመስክ ስም | ዓይነት | አስፈላጊ? | መገለጫ |
|------|-----------|------|---------|---------|
| 1    | ኢሜል     | email | አዎ     | የተመዘገቡበት ኢሜል አድራሻ |
```

Standard GFM pipe table, header + separator row + body rows. Use these five
columns consistently across the manual — a reader flipping between chapters
should be able to rely on the column order. Only add a table for screens
that actually have a form; a pure display/report screen doesn't need one.

## Other supported elements

- `**bold**`, `*italic*`, `` `code` ``, `[link](url)` — inline, as usual.
- `- item` / `1. item` — bullet and numbered lists.
- `---` on its own line — a horizontal rule (renders as a section divider,
  not a page break).
- Plain paragraphs — any run of non-blank lines not matching the above.

## Full worked example

This is the exact example from this skill's own design brief — treat it as
the canonical reference for how a complete screen section should look:

    ### 2.2 መግቢያ (Login)

    ![ስክሪንሾት: መግቢያ ገጽ — /login]
    (assets/screenshots/login.png)

    > **ስክሪንሾት መግለጫ:** ይህ ገጽ የመግቢያ መስክ (Login Form) ይዟል።
    > በላይኛው ግራ ጥግ "ወረዳ ፖርታል" ሎጎ እና ስም ይታያል።
    > መሀከል ላይ "ኢሜል" እና "የይለፍ ቃል" መስኮች አሉ።
    > ከዚያ በታች "መግባ" (Login) የሚለውን የአዝራር ቁልፍ ማጫን ይቻላል።
    > "የይለፍ ቃልዎን ረሱ?" መስኮች ወደ ማስታወሻ ገጽ ይሰጣል።

    > **ቁጥር:** 2.2-አ

    **መግቢያ ለመስጠት የሚከተሉትን ደረጃዎች ይከተሉ:**

    1. **ኢሜል መጻፍ** — የተመዘገቡበትን ኢሜል ያስገቡ።
       > ❌ **ስህተት:** ልክ ያልሆነ ኢሜል ከገቡ "ልክ ያልሆነ ኢሜል" የሚለውን ስህተት ያገኛሉ።
    2. **የይለፍ ቃል መጻፍ** — የይለፍ ቃልዎን ያስገቡ።
       > ⚠️ **ማስጠንቀቂያ:** የይለፍ ቃል ዝቅተኛ ርዝመት 8 ቁምፊ ነው።
    3. **መግባ ማጫን** — "መግባ" የሚለውን የአዝራር ቁልፍ ይጫኑ።
       > ✅ **ውጤት:** ወደ ዋና ዳሽቦርድ ይመራዎታል።
       > 💡 **ምክር:** "አስታውስኝ" (Remember Me) ሳጥን ከተመረጠ በሚቀጥለው ጊዜ ኢሜሉ በራስ-ሰር ይሞላል።

    **የመስክ ዝርዝር:**

    | ቁጥር | የመስክ ስም | ዓይነት | አስፈላጊ? | መገለጫ |
    |------|-----------|------|---------|---------|
    | 1    | ኢሜል     | email | አዎ     | የተመዘገቡበት ኢሜል አድራሻ |
    | 2    | የይለፍ ቃል | password | አዎ | የመግቢያ የይለፍ ቃል |
    | 3    | አስታውስኝ   | checkbox | የለም | ኢሜሉ ለቀጣይ ጊዜ ይቀመጥለታል |

    ![ስክሪንሾት: መግቢያ ስህተት ሁኔታ — /login (error)]
    (assets/screenshots/login-error.png)

    > **ስክሪንሾት መግለጫ:** የመግቢያ ስህተት ሲከሰት ቀይ ቀለም ያለው መልዕክት ከመስክ ጋር ይታያል።
    >
    > **ቁጥር:** 2.2-ብ
