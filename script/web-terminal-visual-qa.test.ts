import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { BUILT_IN_REDACTION_RULE_COUNT } from "./qa/web-terminal-redaction.mjs"

const helperFilePath = fileURLToPath(new URL("./qa/web-terminal-visual-qa.mjs", import.meta.url))

const tempDirs: string[] = []

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "omo-web-terminal-visual-qa-"))
  tempDirs.push(path)
  return path
}

async function spawnHelper(argv: readonly string[]) {
  const proc = Bun.spawn({ cmd: [process.execPath, helperFilePath, ...argv], stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdoutText, stderrText] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { exitCode, stdoutText, stderrText }
}

// The --from-file + --no-browser path is pure (no node-pty, no Chrome), so it
// deterministically exercises the evidence contract and redaction in CI. The
// live xterm.js + node-pty capture is proven by manual QA evidence on disk.
async function renderTranscript(fileName: string, title: string, contents: string, extraArgs: readonly string[] = []) {
  const dir = makeTempDir()
  const transcript = join(dir, fileName)
  writeFileSync(transcript, contents, "utf8")
  const { exitCode, stdoutText, stderrText } = await spawnHelper([
    "--title", title, "--from-file", transcript, "--evidence-dir", dir, "--no-browser", ...extraArgs,
  ])
  expect(stderrText).toBe("")
  expect(exitCode).toBe(0)
  return {
    dir,
    stdoutText,
    text: () => readFileSync(join(dir, "terminal.txt"), "utf8"),
    ansi: () => readFileSync(join(dir, "terminal-ansi.txt"), "utf8"),
    metadata: () => JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")),
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("web terminal visual QA helper", () => {
  test("#given a transcript #when rendering evidence #then files and xterm.js color-path metadata are written", async () => {
    // given
    const rendered = await renderTranscript("capture.txt", "Codex TUI QA", "Codex TUI\n> ready\n")

    // then
    expect(rendered.stdoutText).toContain("metadata.json")
    expect(rendered.text()).toContain("Codex TUI")
    expect(rendered.metadata()).toMatchObject({
      connector: "file-raw",
      colorPath: "xterm.js (true color; not tmux)",
      browserCapture: "skipped",
      source: { kind: "file-replay" },
      files: { text: join(rendered.dir, "terminal.txt"), png: null },
    })
  })

  test("#given ANSI escapes #when rendering #then the raw stream is preserved and text is plain", async () => {
    // given
    const rendered = await renderTranscript("ansi.txt", "ANSI QA", "\u001b[31mred\u001b[0m \u001b[1;32mbold green\u001b[0m\n")

    // then
    expect(rendered.ansi()).toContain("\u001b[31mred")
    expect(rendered.text()).toBe("red bold green\n")
  })

  test("#given secret-bearing output #when rendering #then text ansi and metadata are redacted", async () => {
    // given
    const literalSecret = "local-secret-value"
    const rendered = await renderTranscript(
      "secret.txt",
      "Secret QA",
      [
        "Authorization: Bearer ghp_1234567890abcdefghijklmnop",
        "OPENAI_API_KEY=sk-1234567890abcdefghijklmnop",
        `custom=${literalSecret}`,
        "session_id=sess_live_12345",
      ].join("\n"),
      ["--redact", literalSecret, "--redact-regex", "sess_live_[0-9]+"],
    )

    // then
    const combined = [rendered.text(), rendered.ansi(), JSON.stringify(rendered.metadata())].join("\n")
    expect(combined).not.toContain("ghp_1234567890abcdefghijklmnop")
    expect(combined).not.toContain("sk-1234567890abcdefghijklmnop")
    expect(combined).not.toContain(literalSecret)
    expect(combined).not.toContain("sess_live_12345")
    expect(combined).toContain("[REDACTED]")
    expect(rendered.metadata()).toMatchObject({
      redaction: { builtInRules: BUILT_IN_REDACTION_RULE_COUNT, literalRules: 1, regexRules: 1 },
    })
  })

  test("#given help output #when inspecting the helper #then it documents the xterm.js color path and forbids tmux", async () => {
    // when
    const { exitCode, stdoutText, stderrText } = await spawnHelper(["--help"])

    // then
    expect(stderrText).toBe("")
    expect(exitCode).toBe(0)
    expect(stdoutText).toContain("--command")
    expect(stdoutText).toContain("--from-file")
    expect(stdoutText).toContain("--input")
    expect(stdoutText).toContain("--redact")
    expect(stdoutText).toContain("xterm.js")
    expect(stdoutText).toContain("NEVER tmux")
    expect(stdoutText).toContain("The raw --command string is never stored")
  })

  test("#given conflicting sources #when both --from-file and --command are given #then it errors", async () => {
    // when
    const dir = makeTempDir()
    const { exitCode, stderrText } = await spawnHelper([
      "--title", "x", "--from-file", "a", "--command", "b", "--evidence-dir", dir,
    ])

    // then
    expect(exitCode).toBe(1)
    expect(stderrText).toContain("choose exactly one of --from-file or --command")
  })
})
