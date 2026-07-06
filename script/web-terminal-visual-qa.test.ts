import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { BUILT_IN_REDACTION_RULE_COUNT } from "./qa/web-terminal-redaction.mjs"

const helperPath = new URL("./qa/web-terminal-visual-qa.mjs", import.meta.url)
const helperFilePath = fileURLToPath(helperPath)

const tempDirs: string[] = []

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "omo-web-terminal-visual-qa-"))
  tempDirs.push(path)
  return path
}

async function renderTranscript(fileName: string, title: string, contents: string, extraArgs: readonly string[] = []) {
  const dir = makeTempDir()
  const transcript = join(dir, fileName)
  writeFileSync(transcript, contents, "utf8")

  const proc = Bun.spawn({
    cmd: [
      process.execPath,
      helperFilePath,
      "--title",
      title,
      "--from-file",
      transcript,
      "--evidence-dir",
      dir,
      "--no-browser",
      ...extraArgs,
    ],
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdoutText, stderrText] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  expect(stderrText).toBe("")
  expect(exitCode).toBe(0)
  return {
    dir,
    stdoutText,
    html: () => readFileSync(join(dir, "terminal.html"), "utf8"),
    text: () => readFileSync(join(dir, "terminal.txt"), "utf8"),
    ansi: () => readFileSync(join(dir, "terminal-ansi.txt"), "utf8"),
    metadata: () => JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")),
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("web terminal visual QA helper", () => {
  test("#given a transcript file #when rendering without browser capture #then evidence files and metadata are written", async () => {
    // given
    const rendered = await renderTranscript("capture.txt", "Codex TUI QA", "Codex TUI\n> ready\n")

    // then
    expect(rendered.stdoutText).toContain("metadata.json")
    expect(rendered.text()).toContain("Codex TUI")
    expect(rendered.html()).toContain("Codex TUI QA")

    expect(rendered.metadata()).toMatchObject({
      connector: "file-replay",
      browserCapture: "skipped",
      source: {
        kind: "file-replay",
      },
      wrap: "on",
      files: {
        html: join(rendered.dir, "terminal.html"),
        text: join(rendered.dir, "terminal.txt"),
      },
    })
  })

  test("#given secret-bearing terminal output #when rendering #then text ansi html and metadata are redacted", async () => {
    // given
    const literalSecret = "local-secret-value"
    const customCapturingSecret = "cap-secret-12345"
    const rendered = await renderTranscript(
      "secret-capture.txt",
      "Secret QA",
      [
        "Authorization: Bearer ghp_1234567890abcdefghijklmnop",
        '{"headers":{"Authorization":"Bearer jsonSecretToken1234567890"}}',
        "{ headers: { Authorization: 'Bearer objectSecretToken1234567890' } }",
        "{ headers: { 'authorization': 'Bearer singleQuotedKeySecret1234567890' } }",
        "OPENAI_API_KEY=sk-1234567890abcdefghijklmnop",
        'TOKEN="abc123SECRET"',
        "PASSWORD='hunter2SECRET'",
        'API_KEY="sk-test-SECRET"',
        "SECRET='very-secret-value'",
        `custom=${literalSecret}`,
        `capturing=${customCapturingSecret}`,
        "session_id=sess_live_12345",
      ].join("\n"),
      ["--redact", literalSecret, "--redact-regex", "(cap-secret-)([0-9]+)", "--redact-regex", "sess_live_[0-9]+"],
    )

    // then
    const textArtifact = rendered.text()
    const textLines = textArtifact.split("\n")
    expect(textLines).toContain("Authorization: Bearer [REDACTED]")
    expect(textLines).toContain('{"headers":{"Authorization":"Bearer [REDACTED]"}}')
    expect(textLines).toContain("{ headers: { Authorization: 'Bearer [REDACTED]' } }")
    expect(textLines).toContain("{ headers: { 'authorization': 'Bearer [REDACTED]' } }")

    const combinedArtifacts = [rendered.text(), rendered.ansi(), rendered.html(), JSON.stringify(rendered.metadata())].join("\n")
    expect(combinedArtifacts).not.toContain("ghp_1234567890abcdefghijklmnop")
    expect(combinedArtifacts).not.toContain("jsonSecretToken1234567890")
    expect(combinedArtifacts).not.toContain("objectSecretToken1234567890")
    expect(combinedArtifacts).not.toContain("singleQuotedKeySecret1234567890")
    expect(combinedArtifacts).not.toContain("sk-1234567890abcdefghijklmnop")
    expect(combinedArtifacts).not.toContain("abc123SECRET")
    expect(combinedArtifacts).not.toContain("hunter2SECRET")
    expect(combinedArtifacts).not.toContain("sk-test-SECRET")
    expect(combinedArtifacts).not.toContain("very-secret-value")
    expect(combinedArtifacts).not.toContain(literalSecret)
    expect(combinedArtifacts).not.toContain(customCapturingSecret)
    expect(combinedArtifacts).not.toContain("cap-secret-")
    expect(combinedArtifacts).not.toContain("sess_live_12345")
    expect(combinedArtifacts).toContain("[REDACTED]")
    expect(rendered.metadata()).toMatchObject({
      redaction: {
        builtInRules: BUILT_IN_REDACTION_RULE_COUNT,
        literalRules: 1,
        regexRules: 2,
      },
    })
  })

  test("#given ANSI color and style escapes #when rendering #then HTML preserves terminal styling while text stays plain", async () => {
    // given
    const rendered = await renderTranscript(
      "ansi-capture.txt",
      "ANSI QA",
      "\u001b[31mred\u001b[0m \u001b[1;32mbold green\u001b[0m\n",
    )

    // then
    expect(rendered.ansi()).toContain("\u001b[31mred")
    expect(rendered.text()).toBe("red bold green\n")

    const html = rendered.html()
    expect(html).toContain('class="ansi-fg-red"')
    expect(html).toContain('class="ansi-bold ansi-fg-green"')
    expect(html).toContain("bold green")
  })

  test("#given inverse video with default colors #when rendering #then foreground and background swap without filter CSS", async () => {
    // given
    const rendered = await renderTranscript(
      "inverse-default.txt",
      "Inverse Default QA",
      "\u001b[7m selected row \u001b[0m\n",
    )

    // then
    const html = rendered.html()
    expect(html).toContain(
      '<span style="color: #090b10; background-color: #d8dee9"> selected row </span>',
    )
    expect(html).not.toContain("ansi-inverse")
    expect(html).not.toContain("filter: invert")
  })

  test("#given inverse video with explicit colors #when rendering #then foreground and background classes swap", async () => {
    // given
    const rendered = await renderTranscript(
      "inverse-explicit.txt",
      "Inverse Explicit QA",
      "\u001b[31;44;7m selected \u001b[0m\n",
    )

    // then
    expect(rendered.html()).toContain('<span class="ansi-fg-blue ansi-bg-red"> selected </span>')
  })

  test("#given inverse video is reset #when rendering #then later text uses normal colors", async () => {
    // given
    const rendered = await renderTranscript(
      "inverse-reset.txt",
      "Inverse Reset QA",
      "\u001b[31;44;7minverse\u001b[27m normal\u001b[0m plain\n",
    )

    // then
    expect(rendered.html()).toContain(
      '<span class="ansi-fg-blue ansi-bg-red">inverse</span><span class="ansi-fg-red ansi-bg-blue"> normal</span> plain',
    )
  })

  test("#given truecolor and OSC controls #when rendering #then colors are preserved and controls are stripped", async () => {
    // given
    const rendered = await renderTranscript(
      "truecolor-osc.txt",
      "Truecolor OSC QA",
      [
        "\u001b[38;2;12;34;56msemicolon truecolor\u001b[0m",
        "\u001b[38:2::255:0:0mcolon truecolor\u001b[0m",
        "\u001b[38:2:0:255:0:0mcolon truecolor colorspace\u001b[0m",
        "\u001b]8;;https://example.com\u0007visible label\u001b]8;;\u0007",
      ].join("\n"),
    )

    // then
    expect(rendered.text()).toBe(
      "semicolon truecolor\ncolon truecolor\ncolon truecolor colorspace\nvisible label",
    )

    const html = rendered.html()
    expect(html).toContain('style="color: rgb(12, 34, 56)"')
    expect(html).toContain('<span style="color: rgb(255, 0, 0)">colon truecolor</span>')
    expect(html).toContain('<span style="color: rgb(255, 0, 0)">colon truecolor colorspace</span>')
    expect(html).toContain("visible label")
    expect(html).not.toContain("\u001b]")
    expect(html).not.toContain("https://example.com")
  })

  test("#given a very long line #when rendering with defaults #then wrapping is enabled and recorded", async () => {
    // given
    const rendered = await renderTranscript("long-line.txt", "Long Line QA", `${"x".repeat(260)}\n`)

    // then
    const html = rendered.html()
    expect(html).toContain("white-space: pre-wrap")
    expect(html).toContain("overflow-wrap: anywhere")

    expect(rendered.metadata()).toMatchObject({
      wrap: "on",
      dimensions: { cols: 140, rows: 40 },
    })
  })

  test("#given help output #when inspecting the helper #then it documents tmux connector and browser evidence", async () => {
    // when
    const proc = Bun.spawn({
      cmd: [process.execPath, helperFilePath, "--help"],
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stdoutText, stderrText] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    // then
    expect(stderrText).toBe("")
    expect(exitCode).toBe(0)
    expect(stdoutText).toContain("--command")
    expect(stdoutText).toContain("--from-file")
    expect(stdoutText).toContain("--no-wrap")
    expect(stdoutText).toContain("--redact")
    expect(stdoutText).toContain("--source-label")
    expect(stdoutText).toContain("tmux-backed PTY connector")
    expect(stdoutText).toContain("PNG")
    expect(stdoutText).toContain("The raw --command string is treated as secret-bearing process data")
  })

})
