#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_TERMINAL_BACKGROUND,
  DEFAULT_TERMINAL_FOREGROUND,
  ansiColorCss,
  escapeHtml,
  renderAnsiToHtml,
  stripAnsi,
} from "./web-terminal-renderer.mjs";
import {
  BUILT_IN_REDACTION_RULE_COUNT,
  compileRedactions,
  redactEvidence,
} from "./web-terminal-redaction.mjs";

const HELP = `web-terminal-visual-qa

Render terminal/TUI evidence through a browser-capturable web page.

Usage:
  node script/qa/web-terminal-visual-qa.mjs --title "Codex TUI" --from-file pane.txt --evidence-dir .omo/evidence/run
  node script/qa/web-terminal-visual-qa.mjs --title "OpenCode TUI" --command "opencode --help" --evidence-dir .omo/evidence/run

Inputs:
  --from-file <path>     Replay an existing terminal/tmux transcript.
  --command <command>    Run a command through a tmux-backed PTY connector, capture the pane, then clean up.
  --cwd <path>           Working directory for --command. Defaults to current directory.
  --cols <n>             Terminal columns for tmux connector. Default: 140.
  --rows <n>             Terminal rows for tmux connector. Default: 40.
  --dwell-ms <n>         Milliseconds to let --command render before capture. Default: 3000.
  --wrap                 Wrap long terminal lines in HTML/PNG evidence. Default.
  --no-wrap              Preserve long lines with horizontal scrolling.
  --evidence-dir <path>  Directory for terminal.txt, terminal-ansi.txt, terminal.html, terminal.png, metadata.json.
  --chrome-bin <path>    Chrome/Chromium executable for PNG capture.
  --source-label <text>  Safe label for --command metadata. The raw command is never written to metadata.
  --redact <literal>     Literal secret value to redact before writing evidence. Repeatable.
  --redact-regex <expr>  JavaScript regex source to redact before writing evidence. Repeatable.
  --no-browser           Skip PNG capture, but still write HTML/text/metadata.

Connector notes:
  --command uses tmux as the tmux-backed PTY connector on macOS/Linux and on Windows environments that provide tmux.
  Windows-native ConPTY live mode should plug into this same metadata contract later; until then use --from-file or Git Bash/tmux.

Secret handling:
  Terminal evidence is redacted before terminal.txt, terminal-ansi.txt, terminal.html, and terminal.png are written.
  Built-in rules cover common Authorization headers, token/password/key assignments, and GitHub/OpenAI-style tokens.
  Add --redact for exact local values and --redact-regex for project-specific patterns.
  The raw --command string is treated as secret-bearing process data and is never stored in metadata.json.
`;

function parseArgs(argv) {
  const args = {
    cols: 140,
    rows: 40,
    dwellMs: 3000,
    cwd: process.cwd(),
    browser: true,
    wrap: true,
    redactions: [],
    redactRegexes: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { ...args, help: true };
    if (arg === "--no-browser") {
      args.browser = false;
      continue;
    }
    if (arg === "--wrap") {
      args.wrap = true;
      continue;
    }
    if (arg === "--no-wrap") {
      args.wrap = false;
      continue;
    }
    const next = argv[i + 1];
    if (!next) throw new Error(`missing value for ${arg}`);
    i += 1;
    if (arg === "--title") args.title = next;
    else if (arg === "--from-file") args.fromFile = next;
    else if (arg === "--command") args.command = next;
    else if (arg === "--cwd") args.cwd = next;
    else if (arg === "--evidence-dir") args.evidenceDir = next;
    else if (arg === "--chrome-bin") args.chromeBin = next;
    else if (arg === "--source-label") args.sourceLabel = next;
    else if (arg === "--redact") args.redactions.push(next);
    else if (arg === "--redact-regex") args.redactRegexes.push(next);
    else if (arg === "--cols") args.cols = parsePositiveInt(arg, next);
    else if (arg === "--rows") args.rows = parsePositiveInt(arg, next);
    else if (arg === "--dwell-ms") args.dwellMs = parsePositiveInt(arg, next);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function parsePositiveInt(name, value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function requireArgs(args) {
  if (!args.evidenceDir) throw new Error("--evidence-dir is required");
  if (!args.title) throw new Error("--title is required");
  if (args.fromFile && args.command) throw new Error("choose exactly one of --from-file or --command");
  if (!args.fromFile && !args.command) throw new Error("choose --from-file or --command");
}

function terminalWidthCh(cols) {
  return Math.max(80, Math.min(cols, 160));
}

function screenshotSize({ cols, rows }) {
  return {
    width: Math.max(900, Math.min(1440, Math.round(cols * 8.2 + 120))),
    height: Math.max(520, Math.min(1200, Math.round(rows * 18 + 120))),
  };
}

function sourceMetadata(args) {
  if (args.fromFile) return { kind: "file-replay", path: resolve(args.fromFile) };
  return { kind: "command", label: args.sourceLabel || "redacted command" };
}

function writeHtml({ title, ansi, outPath, cols, wrap }) {
  const whiteSpace = wrap ? "pre-wrap" : "pre";
  const overflowWrap = wrap ? "anywhere" : "normal";
  const terminalWidth = terminalWidthCh(cols);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #101217; color: ${DEFAULT_TERMINAL_FOREGROUND}; font: 13px/1.35 "SFMono-Regular", "Cascadia Mono", "JetBrains Mono", "Menlo", "Consolas", "Liberation Mono", ui-monospace, monospace; }
main { min-height: 100vh; box-sizing: border-box; padding: 20px; }
.terminal { width: min(100%, ${terminalWidth}ch); max-width: calc(100vw - 40px); border: 1px solid #3b4452; background: ${DEFAULT_TERMINAL_BACKGROUND}; box-shadow: 0 20px 80px rgb(0 0 0 / 40%); }
.bar { display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid #303846; color: #aab7c4; background: #171b22; font-size: 12px; }
.dot { width: 10px; height: 10px; border-radius: 999px; background: #6b7280; }
pre { margin: 0; padding: 14px 16px; white-space: ${whiteSpace}; overflow-wrap: ${overflowWrap}; tab-size: 8; overflow: auto; }
.ansi-bold { font-weight: 700; }
.ansi-dim { opacity: 0.72; }
.ansi-italic { font-style: italic; }
.ansi-underline { text-decoration: underline; }
.ansi-strike { text-decoration: line-through; }
${ansiColorCss()}
</style>
</head>
<body><main><section class="terminal"><div class="bar"><span class="dot"></span><strong>${escapeHtml(title)}</strong></div><pre>${renderAnsiToHtml(ansi)}</pre></section></main></body>
</html>
`;
  writeFileSync(outPath, html, "utf8");
}

function captureFromFile(path) {
  const ansi = readFileSync(path, "utf8");
  return { ansi, cleanup: "cleanup: file replay; no live process", connector: "file-replay" };
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function runTmuxCommand(args) {
  const tmux = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmux.status !== 0) throw new Error("--command requires tmux on PATH; use --from-file on hosts without tmux");
  const session = `omo_webterm_${process.pid}_${Date.now()}`;
  const wrapped = `${args.command}; printf '\\n[web-terminal-visual-qa exit:%s]\\n' "$?"; sleep 600`;
  const launch = spawnSync("tmux", ["new-session", "-d", "-s", session, "-x", String(args.cols), "-y", String(args.rows), "-c", resolve(args.cwd), "sh", "-lc", wrapped], { encoding: "utf8" });
  if (launch.status !== 0) throw new Error(`tmux launch failed: ${launch.stderr || launch.stdout}`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, args.dwellMs);
  const plain = spawnSync("tmux", ["capture-pane", "-p", "-S", "-", "-t", session], { encoding: "utf8" });
  const ansi = spawnSync("tmux", ["capture-pane", "-e", "-p", "-S", "-", "-t", session], { encoding: "utf8" });
  spawnSync("tmux", ["kill-session", "-t", session], { encoding: "utf8" });
  const plainCapture = plain.status === 0 ? plain.stdout : "";
  const ansiCapture = ansi.status === 0 ? ansi.stdout : "";
  const captured = ansiCapture || plainCapture;
  if (!captured || stripAnsi(captured).trim().length === 0) {
    const detail = [plain.stderr || plain.stdout, ansi.stderr || ansi.stdout].filter(Boolean).join("; ");
    throw new Error(`tmux capture was empty${detail ? `: ${detail}` : ""}`);
  }
  return {
    ansi: captured,
    cleanup: `cleanup: tmux kill-session -t ${shellQuote(session)}`,
    connector: "tmux-backed-pty",
  };
}

function chromeCandidates(explicit) {
  const candidates = [explicit, process.env.CHROME_BIN, process.env.GOOGLE_CHROME_BIN];
  if (process.platform === "darwin") candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium");
  if (process.platform === "linux") candidates.push("google-chrome", "google-chrome-stable", "chromium", "chromium-browser");
  if (process.platform === "win32") {
    candidates.push(join(process.env.PROGRAMFILES || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"));
    candidates.push(join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"));
  }
  return candidates.filter((candidate) => candidate && (candidate.includes("/") || candidate.includes("\\") ? existsSync(candidate) : true));
}

function capturePng(args) {
  for (const chrome of chromeCandidates(args.chromeBin)) {
    const result = spawnSync(chrome, ["--headless=new", "--disable-gpu", `--window-size=${args.width},${args.height}`, `--screenshot=${args.pngPath}`, pathToFileURL(args.htmlPath).href], { encoding: "utf8" });
    if (result.status === 0 && existsSync(args.pngPath)) return { status: "captured", chrome };
  }
  throw new Error("PNG capture failed: set --chrome-bin or --no-browser");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  requireArgs(args);
  const evidenceDir = resolve(args.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const htmlPath = join(evidenceDir, "terminal.html");
  const textPath = join(evidenceDir, "terminal.txt");
  const ansiPath = join(evidenceDir, "terminal-ansi.txt");
  const pngPath = join(evidenceDir, "terminal.png");
  const metadataPath = join(evidenceDir, "metadata.json");
  const capture = args.fromFile ? captureFromFile(args.fromFile) : runTmuxCommand(args);
  const redactionRules = compileRedactions(args);
  const safeAnsi = redactEvidence(capture.ansi, redactionRules);
  const text = stripAnsi(safeAnsi);
  writeFileSync(textPath, text, "utf8");
  writeFileSync(ansiPath, safeAnsi, "utf8");
  writeHtml({ title: args.title, ansi: safeAnsi, outPath: htmlPath, cols: args.cols, wrap: args.wrap });
  const size = screenshotSize({ cols: args.cols, rows: args.rows });
  const browser = args.browser ? capturePng({ chromeBin: args.chromeBin, htmlPath, pngPath, ...size }) : { status: "skipped" };
  const metadata = {
    title: args.title,
    connector: capture.connector,
    browserCapture: browser.status,
    source: sourceMetadata(args),
    redaction: {
      builtInRules: BUILT_IN_REDACTION_RULE_COUNT,
      literalRules: args.redactions.length,
      regexRules: args.redactRegexes.length,
    },
    wrap: args.wrap ? "on" : "off",
    dimensions: { cols: args.cols, rows: args.rows, screenshotWidth: size.width, screenshotHeight: size.height },
    cleanup: capture.cleanup,
    files: { html: htmlPath, text: textPath, ansi: ansiPath, png: browser.status === "captured" ? pngPath : null, metadata: metadataPath },
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  process.stdout.write(`web terminal visual QA evidence (${basename(evidenceDir)}):\n${JSON.stringify(metadata.files, null, 2)}\n${capture.cleanup}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
