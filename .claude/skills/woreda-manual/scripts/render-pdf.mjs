#!/usr/bin/env node
// Renders a Markdown manual (using this skill's Amharic manual conventions)
// into a professional business PDF, using the Chromium binary that's already
// on disk in this environment (PLAYWRIGHT_BROWSERS_PATH) driven directly over
// the DevTools protocol. No npm dependency is added to the app for this —
// Node 22's built-in `WebSocket` is enough to talk CDP, and the CLI's own
// `--print-to-pdf` flag can't do header/footer templates (page numbers),
// which is why this goes through CDP's Page.printToPDF instead.
//
// Usage: node render-pdf.mjs <input.md> <output.pdf> [--title "..."]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");

function findChrome() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(
    "Could not find the pre-installed Chromium binary. Set PLAYWRIGHT_CHROMIUM_PATH " +
      "or check /opt/pw-browsers for the actual chromium-<rev> directory name.",
  );
}

// ---------- Markdown -> HTML ----------
// This is intentionally NOT a general-purpose Markdown parser. It only
// supports the subset this skill's manuals actually use, documented in
// references/markdown-conventions.md: headings, paragraphs, bold/italic,
// bullet/numbered lists, pipe tables, blockquote callouts, hr, links, and
// the `![Screenshot: ...](path)` placeholder convention. Keeping it narrow
// keeps it predictable — a manual written to the convention renders
// correctly every time, rather than depending on a general parser's
// edge-case handling of Amharic punctuation or nested emphasis.

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s) {
  let out = escapeHtml(s);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

function slugify(s, seen) {
  let base = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) base = "section";
  let slug = base;
  let n = 2;
  while (seen.has(slug)) slug = `${base}-${n++}`;
  seen.add(slug);
  return slug;
}

const CALLOUT_PREFIXES = [
  ["❌", "callout-error"],
  ["⚠️", "callout-warning"],
  ["✅", "callout-success"],
  ["💡", "callout-tip"],
];

function renderBlockquote(lines) {
  // Each line inside the quote may itself carry a callout emoji, or be the
  // plain "ስክሪንሾት መግለጫ:" / "ቁጥር:" caption lines used under screenshots.
  const items = lines.map((line) => {
    const trimmed = line.replace(/^>\s?/, "");
    for (const [emoji, cls] of CALLOUT_PREFIXES) {
      if (trimmed.trim().startsWith(emoji)) {
        return `<p class="callout ${cls}">${inline(trimmed.trim())}</p>`;
      }
    }
    return `<p>${inline(trimmed)}</p>`;
  });
  return `<blockquote>${items.join("\n")}</blockquote>`;
}

function renderTable(rows) {
  const [headerLine, , ...bodyLines] = rows;
  const splitRow = (l) =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const header = splitRow(headerLine);
  const body = bodyLines.map(splitRow);
  const thead = `<tr>${header.map((h) => `<th>${inline(h)}</th>`).join("")}</tr>`;
  const tbody = body
    .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

function markdownToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  const toc = [];
  const slugSeen = new Set();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Screenshot placeholder: an image line, optionally followed by a
    // parenthesised path on the next line (the convention in the prompt
    // writes the alt text and the (path) on two lines).
    const imgMatch = line.match(/^!\[(.+?)\]\((.*)\)\s*$/);
    const imgAltOnly = line.match(/^!\[(.+?)\]\s*$/);
    if (imgMatch || imgAltOnly) {
      const alt = (imgMatch || imgAltOnly)[1];
      let src = imgMatch ? imgMatch[2] : "";
      if (!src && lines[i + 1] && /^\(.*\)\s*$/.test(lines[i + 1])) {
        src = lines[i + 1].trim().slice(1, -1);
        i++;
      }
      html.push(
        `<figure class="screenshot-placeholder"><div class="placeholder-box">` +
          `<span class="placeholder-icon">🖼️</span>` +
          `<span class="placeholder-alt">${escapeHtml(alt)}</span>` +
          `<span class="placeholder-path">${escapeHtml(src || "path pending")}</span>` +
          `</div></figure>`,
      );
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const slug = slugify(text, slugSeen);
      html.push(`<h${level} id="${slug}">${inline(text)}</h${level}>`);
      toc.push({ level, text, slug });
      i++;
      continue;
    }

    if (/^---\s*$/.test(line)) {
      html.push("<hr/>");
      i++;
      continue;
    }

    if (/^>/.test(line)) {
      const block = [];
      while (i < lines.length && /^>/.test(lines[i])) {
        block.push(lines[i]);
        i++;
      }
      html.push(renderBlockquote(block));
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && lines[i + 1] && /^\s*\|?\s*-{2,}/.test(lines[i + 1])) {
      const block = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        block.push(lines[i]);
        i++;
      }
      html.push(renderTable(block));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      html.push(`<ul>${items.map((it) => `<li>${inline(it)}</li>`).join("\n")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      html.push(`<ol>${items.map((it) => `<li>${inline(it)}</li>`).join("\n")}</ol>`);
      continue;
    }

    // Plain paragraph — gather consecutive non-blank lines.
    const para = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^>/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^!\[/.test(lines[i]) &&
      !/^---\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    html.push(`<p>${inline(para.join(" "))}</p>`);
  }

  return { body: html.join("\n"), toc };
}

function renderToc(toc) {
  // Only h1/h2/h3 go in the table of contents — h4 is field/table-level detail.
  const items = toc.filter((t) => t.level <= 3);
  const rows = items
    .map(
      (t) => `<li class="toc-level-${t.level}"><a href="#${t.slug}">${escapeHtml(t.text)}</a></li>`,
    )
    .join("\n");
  return `<ol class="toc">${rows}</ol>`;
}

function toDataUri(fontPath, mime) {
  const buf = readFileSync(fontPath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function buildHtmlDocument({ title, subtitle, bodyHtml, tocHtml }) {
  const regular = toDataUri(
    path.join(SKILL_ROOT, "assets/fonts/NotoSansEthiopic-Regular.ttf"),
    "font/ttf",
  );
  const bold = toDataUri(
    path.join(SKILL_ROOT, "assets/fonts/NotoSansEthiopic-Bold.ttf"),
    "font/ttf",
  );
  const cssPath = path.join(SKILL_ROOT, "assets/manual.css");
  const css = readFileSync(cssPath, "utf8")
    .replace("__FONT_REGULAR__", regular)
    .replace("__FONT_BOLD__", bold);
  const today = new Date().toISOString().slice(0, 10);

  return `<!doctype html>
<html lang="am">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
  <section class="cover-page">
    <div class="cover-content">
      <h1 class="cover-title">${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="cover-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      <p class="cover-date">${today}</p>
    </div>
  </section>
  <section class="toc-page">
    <h2>ማውጫ / Table of Contents</h2>
    ${tocHtml}
  </section>
  <section class="content">
    ${bodyHtml}
  </section>
</body>
</html>`;
}

// ---------- CDP driving ----------

async function withChrome(fn) {
  const chromePath = findChrome();
  const userDataDir = path.join(SKILL_ROOT, ".chrome-profile-" + Date.now());
  const proc = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${userDataDir}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  let wsUrl = null;
  const wsUrlPromise = new Promise((resolve, reject) => {
    let buf = "";
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for Chromium devtools port")),
      15000,
    );
    proc.stderr.on("data", (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timeout);
        resolve(m[1]);
      }
    });
    proc.on("exit", (code) => {
      if (!wsUrl) reject(new Error(`Chromium exited early with code ${code}`));
    });
  });

  try {
    wsUrl = await wsUrlPromise;
    const result = await fn(wsUrl);
    return result;
  } finally {
    proc.kill("SIGKILL");
    // Best-effort profile cleanup; leaving it behind is harmless but untidy.
    try {
      spawn("rm", ["-rf", userDataDir]);
    } catch {
      /* ignore */
    }
  }
}

function cdpConnect(browserWsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(browserWsUrl);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", (e) => reject(e));
  });
}

function cdpSend(ws, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        ws.removeEventListener("message", handler);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

async function printHtmlToPdf(browserWsUrl, htmlPath, pdfPath) {
  const ws = await cdpConnect(browserWsUrl);
  try {
    const target = await cdpSend(ws, "Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdpSend(ws, "Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    await cdpSend(ws, "Page.enable", {}, sessionId);
    const fileUrl = "file://" + path.resolve(htmlPath);
    const nav = await cdpSend(ws, "Page.navigate", { url: fileUrl }, sessionId);
    await new Promise((resolve) => {
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.method === "Page.frameStoppedLoading" && msg.params.frameId === nav.frameId) {
          ws.removeEventListener("message", handler);
          resolve();
        }
      };
      ws.addEventListener("message", handler);
    });
    // Fonts and layout need a beat after "stopped loading" fires.
    await new Promise((r) => setTimeout(r, 500));

    const footerTemplate = `
      <div style="font-size:9px; width:100%; text-align:center; color:#666; padding-top:2px;">
        <span class="pageNumber"></span> / <span class="totalPages"></span>
      </div>`;
    const headerTemplate = `<div></div>`; // blank — running header handled in-page via CSS

    const { data } = await cdpSend(
      ws,
      "Page.printToPDF",
      {
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate,
        marginTop: 0.6,
        marginBottom: 0.6,
        marginLeft: 0,
        marginRight: 0,
      },
      sessionId,
    );
    writeFileSync(pdfPath, Buffer.from(data, "base64"));
  } finally {
    ws.close();
  }
}

// ---------- main ----------

async function main() {
  const [, , inputMd, outputPdf, ...rest] = process.argv;
  if (!inputMd || !outputPdf) {
    console.error("Usage: node render-pdf.mjs <input.md> <output.pdf> [--title T] [--subtitle S]");
    process.exit(1);
  }
  const titleFlagIdx = rest.indexOf("--title");
  const subtitleFlagIdx = rest.indexOf("--subtitle");
  const title = titleFlagIdx >= 0 ? rest[titleFlagIdx + 1] : "የወረዳ ፖርታል የተጠቃሚ መመሪያ";
  const subtitle = subtitleFlagIdx >= 0 ? rest[subtitleFlagIdx + 1] : "Woreda Portal User Manual";

  const md = readFileSync(inputMd, "utf8");
  const { body, toc } = markdownToHtml(md);
  const tocHtml = renderToc(toc);
  const htmlDoc = buildHtmlDocument({ title, subtitle, bodyHtml: body, tocHtml });

  const htmlPath = outputPdf.replace(/\.pdf$/, "") + ".render.html";
  writeFileSync(htmlPath, htmlDoc, "utf8");

  await withChrome(async (wsUrl) => {
    await printHtmlToPdf(wsUrl, htmlPath, outputPdf);
  });

  console.log(`Wrote ${outputPdf}`);
  console.log(`(intermediate HTML kept at ${htmlPath} for inspection)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
