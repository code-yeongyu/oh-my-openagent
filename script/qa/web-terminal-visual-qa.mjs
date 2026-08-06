#!/usr/bin/env node
// Render terminal/TUI evidence through a REAL xterm.js terminal in a browser.
//
// A command runs in a real pty (node-pty), streams into xterm.js inside headless
// Chrome, is driven with scripted keystrokes THROUGH the browser terminal, and is
// screenshotted true-color. This replaces the old tmux capture-pane + hand-rolled
// ANSI-to-HTML path, which degraded color and never rendered a real terminal.

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { captureLive } from "./xterm-live-terminal.mjs";
import { BUILT_IN_REDACTION_RULE_COUNT, compileRedactions, redactEvidence } from "./web-terminal-redaction.mjs";
import { stripAnsi } from "./strip-ansi.mjs";

const require = createRequire(import.meta.url);

const HELP = `web-terminal-visual-qa

Render terminal/TUI evidence through a REAL xterm.js terminal captured in a browser (true color, no tmux).

Usage:
  node script/qa/web-terminal-visual-qa.mjs --title "Codex TUI" --command "codex --help" --evidence-dir .omo/evidence/run
  node script/qa/web-terminal-visual-qa.mjs --title "TUI" --command "my-tui" --input "{Down}" --input "{Down}" --input "{Enter}" --evidence-dir .omo/evidence/run
  node script/qa/web-terminal-visual-qa.mjs --title "Replay" --from-file pane.ansi --evidence-dir .omo/evidence/run
  node script/qa/web-terminal-visual-qa.mjs --self-test

Inputs:
  --command <command>    Run in a real node-pty and render live in xterm.js. The color path is xterm.js - NEVER tmux.
  --from-file <path>     Render an existing raw terminal byte stream through xterm.js (replay; no interaction).
  --input <token>        Scripted interaction, repeatable, applied in order THROUGH the browser terminal.
                         Literal text is typed; {Enter} {Tab} {Escape} {ArrowDown} {Ctrl+C} etc. are pressed as keys.
  --cwd <path>           Working directory for --command. Default: current directory.
  --cols <n> / --rows <n>  Terminal geometry. Default: 120 x 32.
  --dwell-ms <n>         Milliseconds to let the TUI settle after input before capture. Default: 1500.
  --key-delay-ms <n>     Pause between --input tokens. Default: 120.
  --evidence-dir <path>  Directory for terminal.png, terminal.txt, terminal-ansi.txt, metadata.json.
  --chrome-bin <path>    Chrome/Chromium executable (else auto-detect or CHROME_BIN).
  --source-label <text>  Safe label for --command metadata. The raw command is never written to metadata.
  --redact <literal>     Literal secret to mask in ALL evidence, PNG included. Repeatable.
  --redact-regex <expr>  JS regex source to mask in ALL evidence, PNG included. Repeatable.
  --no-browser           Skip xterm.js/Chrome; capture the raw pty stream only (no PNG). For chrome-less CI.

Secret handling:
  Text evidence and the screenshot are redacted before anything is written. When a redaction rule matches, the
  masked stream is re-rendered so the PNG never shows the secret. The raw --command string is never stored.
`;

function parsePositiveInt(name, value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseArgs(argv) {
  const args = { cols: 120, rows: 32, dwellMs: 1500, keyDelayMs: 120, cwd: process.cwd(), browser: true, redactions: [], redactRegexes: [], inputs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { ...args, help: true };
    if (arg === "--self-test") return { ...args, selfTest: true };
    if (arg === "--no-browser") { args.browser = false; continue; }
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
    else if (arg === "--input") args.inputs.push(next);
    else if (arg === "--redact") args.redactions.push(next);
    else if (arg === "--redact-regex") args.redactRegexes.push(next);
    else if (arg === "--cols") args.cols = parsePositiveInt(arg, next);
    else if (arg === "--rows") args.rows = parsePositiveInt(arg, next);
    else if (arg === "--dwell-ms") args.dwellMs = parsePositiveInt(arg, next);
    else if (arg === "--key-delay-ms") args.keyDelayMs = parsePositiveInt(arg, next);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function requireArgs(args) {
  if (!args.evidenceDir) throw new Error("--evidence-dir is required");
  if (!args.title) throw new Error("--title is required");
  if (args.fromFile && args.command) throw new Error("choose exactly one of --from-file or --command");
  if (!args.fromFile && !args.command) throw new Error("choose --from-file or --command");
}

function sourceMetadata(args) {
  if (args.fromFile) return { kind: "file-replay", path: resolve(args.fromFile) };
  return { kind: "command", label: args.sourceLabel || "redacted command" };
}

// Chrome-less path: run the command in a real pty and keep the raw stream only.
async function captureRawPty(args) {
  const { chmodSync, existsSync: exists } = await import("node:fs");
  const { dirname, join: pjoin } = await import("node:path");
  try {
    const ptyRoot = dirname(require.resolve("node-pty"));
    const helper = pjoin(ptyRoot, `../prebuilds/${process.platform}-${process.arch}/spawn-helper`);
    if (exists(helper)) chmodSync(helper, 0o755);
  } catch {}
  const pty = require("node-pty");
  const proc = pty.spawn(process.env.SHELL || "bash", ["-lc", args.command], {
    name: "xterm-256color", cols: args.cols, rows: args.rows, cwd: args.cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
  });
  let raw = "";
  proc.onData((d) => { raw += d; });
  await new Promise((r) => setTimeout(r, args.dwellMs + 400));
  try { proc.kill(); } catch {}
  return { pngBuffer: null, screenText: stripAnsi(raw), rawStream: raw, connector: "node-pty-raw", cleanup: `pty pid ${proc.pid} killed` };
}

function captureFileRaw(content) {
  return { pngBuffer: null, screenText: stripAnsi(content), rawStream: content, connector: "file-raw", cleanup: "file replay; no process" };
}

async function run(args) {
  const evidenceDir = resolve(args.evidenceDir);
  mkdirSync(evidenceDir, { recursive: true });
  const rules = compileRedactions(args);
  const redactStream = (s) => redactEvidence(s, rules);
  const fromFile = args.fromFile ? readFileSync(args.fromFile, "utf8") : undefined;

  let cap;
  if (args.browser) cap = await captureLive({ ...args, fromFile, redactStream });
  else if (fromFile !== undefined) cap = captureFileRaw(fromFile);
  else cap = await captureRawPty(args);

  const safeText = redactStream(cap.screenText);
  const safeAnsi = redactStream(cap.rawStream);
  const textPath = join(evidenceDir, "terminal.txt");
  const ansiPath = join(evidenceDir, "terminal-ansi.txt");
  const pngPath = join(evidenceDir, "terminal.png");
  const metadataPath = join(evidenceDir, "metadata.json");
  writeFileSync(textPath, safeText.endsWith("\n") ? safeText : `${safeText}\n`, "utf8");
  writeFileSync(ansiPath, safeAnsi, "utf8");
  if (cap.pngBuffer) writeFileSync(pngPath, cap.pngBuffer);

  const metadata = {
    title: args.title,
    connector: cap.connector,
    colorPath: "xterm.js (true color; not tmux)",
    browserCapture: cap.pngBuffer ? "captured" : "skipped",
    source: sourceMetadata(args),
    interaction: args.inputs,
    redaction: { builtInRules: BUILT_IN_REDACTION_RULE_COUNT, literalRules: args.redactions.length, regexRules: args.redactRegexes.length },
    dimensions: { cols: args.cols, rows: args.rows },
    cleanup: cap.cleanup,
    files: { png: cap.pngBuffer ? pngPath : null, text: textPath, ansi: ansiPath, metadata: metadataPath },
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  process.stdout.write(`web terminal visual QA evidence (${basename(evidenceDir)}):\n${JSON.stringify(metadata.files, null, 2)}\ncleanup: ${cap.cleanup}\n`);
}

async function selfTest() {
  // Asset resolution + real pty capture, without requiring Chrome (chrome-less CI safe).
  for (const spec of ["@xterm/xterm/lib/xterm.js", "@xterm/xterm/css/xterm.css", "@xterm/addon-unicode11/lib/addon-unicode11.js"]) {
    if (readFileSync(require.resolve(spec), "utf8").length < 100) throw new Error(`asset too small: ${spec}`);
  }
  const cap = await captureRawPty({ command: "printf '\\033[31mRED\\033[0m \\033[32mGREEN\\033[0m 한글ABC'", cwd: process.cwd(), cols: 40, rows: 8, dwellMs: 300 });
  if (!/RED/.test(cap.rawStream) || !cap.rawStream.includes("[31m")) throw new Error("pty did not emit expected ANSI");
  if (!cap.rawStream.includes("한글")) throw new Error("pty dropped CJK bytes");
  process.stdout.write("self-test PASS: xterm assets resolve; node-pty emits true-color ANSI + CJK\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }
  if (args.selfTest) { await selfTest(); return; }
  requireArgs(args);
  await run(args);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
