// Live xterm.js + node-pty terminal capture core.
//
// Spawns a command in a REAL pty (node-pty), bridges it to a REAL xterm.js
// terminal running in a headless Chrome page (puppeteer-core drives the system
// Chrome), drives scripted interaction THROUGH the browser terminal, then
// screenshots the xterm.js render. The screenshot is true-color because
// xterm.js interprets the raw pty byte stream itself - no tmux capture-pane,
// no hand-rolled ANSI-to-HTML, no color degradation.

import { createRequire } from "node:module";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function resolveAsset(spec) {
  const path = require.resolve(spec);
  return readFileSync(path, "utf8");
}

// node-pty ships a `spawn-helper` on macOS/Linux that MUST be executable.
// `bun install` (unlike npm) does not run node-pty's chmod postinstall, so the
// committed harness heals the exec bit itself before the first spawn.
function healSpawnHelper() {
  let ptyRoot;
  try {
    ptyRoot = dirname(require.resolve("node-pty"));
  } catch {
    return;
  }
  const candidates = [
    join(ptyRoot, `../prebuilds/${process.platform}-${process.arch}/spawn-helper`),
    join(ptyRoot, "../build/Release/spawn-helper"),
  ];
  for (const helper of candidates) {
    if (existsSync(helper)) {
      try {
        chmodSync(helper, 0o755);
      } catch {
        // best effort - a read-only store still works when the bit is already set
      }
    }
  }
}

function buildPageHtml({ xtermJs, xtermCss, unicodeJs, cols, rows, fontSize }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${xtermCss}
html,body{margin:0;padding:0;background:#0b0e14}
#t{padding:8px}
</style></head><body><div id="t"></div>
<script>${xtermJs}</script>
<script>${unicodeJs}</script>
<script>
  const term = new Terminal({
    cols: ${cols}, rows: ${rows}, fontSize: ${fontSize},
    fontFamily: 'Menlo, "DejaVu Sans Mono", "Noto Sans Mono CJK KR", monospace',
    allowProposedApi: true, convertEol: false, scrollback: 0,
    theme: { background: '#0b0e14', foreground: '#d7dae0' },
  });
  try { const u = new Unicode11Addon.Unicode11Addon(); term.loadAddon(u); term.unicode.activeVersion = '11'; } catch (e) {}
  term.open(document.getElementById('t'));
  window.__writeToTerm = (d) => term.write(d);
  window.__screenText = () => {
    const b = term.buffer.active; const lines = [];
    for (let i = 0; i < b.length; i++) { const ln = b.getLine(i); lines.push(ln ? ln.translateToString(true) : ''); }
    return lines.join('\\n').replace(/\\n+$/, '\\n');
  };
  window.__resetAndWrite = (d) => { term.reset(); term.write(d); };
  term.focus();
  term.onData((d) => { if (window.__ptyInput) window.__ptyInput(d); });
</script></body></html>`;
}

const NAMED_KEYS = new Set([
  "Enter", "Tab", "Escape", "Backspace", "Delete", "Space",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown",
]);

// An `input` token wrapped in {Braces} is pressed as a named key; anything else
// is typed literally. Both flow through the browser terminal (xterm onData ->
// pty), so the interaction is genuinely driven in the web terminal.
async function driveInput(page, inputs, keyDelayMs) {
  for (const raw of inputs) {
    const match = /^\{(.+)\}$/.exec(raw);
    if (match && NAMED_KEYS.has(match[1])) {
      await page.keyboard.press(match[1] === "Space" ? " " : match[1], { delay: 15 });
    } else if (match && /^Ctrl\+(.)$/i.test(match[1])) {
      const key = /^Ctrl\+(.)$/i.exec(match[1])[1];
      await page.keyboard.down("Control");
      await page.keyboard.press(key);
      await page.keyboard.up("Control");
    } else {
      await page.keyboard.type(raw, { delay: 10 });
    }
    if (keyDelayMs > 0) await new Promise((r) => setTimeout(r, keyDelayMs));
  }
}

function chromeCandidates(explicit) {
  const c = [explicit, process.env.CHROME_BIN, process.env.GOOGLE_CHROME_BIN];
  if (process.platform === "darwin")
    c.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium");
  if (process.platform === "linux") c.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  if (process.platform === "win32") {
    c.push(join(process.env.PROGRAMFILES || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"));
    c.push(join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"));
  }
  return c.filter((x) => x && (x.includes("/") || x.includes("\\") ? existsSync(x) : true));
}

async function captureLive({ command, cwd, cols, rows, inputs, dwellMs, keyDelayMs, chromeBin, fromFile, redactStream }) {
  healSpawnHelper();
  const puppeteer = (await import("puppeteer-core")).default;
  const executablePath = chromeCandidates(chromeBin)[0];
  if (!executablePath) throw new Error("no Chrome/Chromium found; set --chrome-bin or CHROME_BIN");

  const html = buildPageHtml({
    xtermJs: resolveAsset("@xterm/xterm/lib/xterm.js"),
    xtermCss: resolveAsset("@xterm/xterm/css/xterm.css"),
    unicodeJs: resolveAsset("@xterm/addon-unicode11/lib/addon-unicode11.js"),
    cols, rows, fontSize: 15,
  });

  const browser = await puppeteer.launch({
    executablePath, headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-color-profile=srgb"],
    defaultViewport: { width: cols * 10 + 40, height: rows * 20 + 40, deviceScaleFactor: 2 },
  });

  let rawStream = "";
  let ptyProc;
  const cleanupParts = [];
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts && document.fonts.ready);

    if (fromFile) {
      rawStream = fromFile;
      const shown = redactStream ? redactStream(rawStream) : rawStream;
      await page.evaluate((d) => window.__writeToTerm(d), shown);
      cleanupParts.push("no pty (replay)");
    } else {
      const pty = require("node-pty");
      ptyProc = pty.spawn(process.env.SHELL || "bash", ["-lc", command], {
        name: "xterm-256color", cols, rows, cwd: cwd || process.cwd(),
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
      await page.exposeFunction("__ptyInput", (d) => { try { ptyProc.write(d); } catch {} });
      ptyProc.onData((d) => {
        rawStream += d;
        page.evaluate((chunk) => window.__writeToTerm(chunk), d).catch(() => {});
      });
      await new Promise((r) => setTimeout(r, 400));
      await page.focus("#t");
      if (inputs.length) await driveInput(page, inputs, keyDelayMs);
      await new Promise((r) => setTimeout(r, dwellMs));
      cleanupParts.push(`pty pid ${ptyProc.pid} killed`);
    }

    // When redactions are configured, re-render the masked stream so the PNG
    // never shows a secret that the interaction surfaced on screen.
    if (redactStream && !fromFile) {
      const masked = redactStream(rawStream);
      if (masked !== rawStream) await page.evaluate((d) => window.__resetAndWrite(d), masked);
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const screenText = await page.evaluate(() => window.__screenText());
    const el = (await page.$(".xterm")) || page;
    const pngBuffer = await el.screenshot({ type: "png" });
    return { pngBuffer, screenText, rawStream, connector: fromFile ? "xterm-replay" : "xterm-node-pty", cleanup: cleanupParts.join("; ") };
  } finally {
    try { ptyProc && ptyProc.kill(); } catch {}
    await browser.close();
  }
}

export { captureLive };
