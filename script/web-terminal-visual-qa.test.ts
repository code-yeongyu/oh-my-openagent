import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const helperPath = new URL("./qa/web-terminal-visual-qa.mjs", import.meta.url)
const helperFilePath = fileURLToPath(helperPath)

const tempDirs: string[] = []

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "omo-web-terminal-visual-qa-"))
  tempDirs.push(path)
  return path
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("web terminal visual QA helper", () => {
  test("#given a transcript file #when rendering without browser capture #then evidence files and metadata are written", async () => {
    // given
    const dir = makeTempDir()
    const transcript = join(dir, "capture.txt")
    writeFileSync(transcript, "Codex TUI\n> ready\n", "utf8")

    // when
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        helperFilePath,
        "--title",
        "Codex TUI QA",
        "--from-file",
        transcript,
        "--evidence-dir",
        dir,
        "--no-browser",
      ],
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
    expect(stdoutText).toContain("metadata.json")
    expect(readFileSync(join(dir, "terminal.txt"), "utf8")).toContain("Codex TUI")
    expect(readFileSync(join(dir, "terminal.html"), "utf8")).toContain("Codex TUI QA")

    const metadata: unknown = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"))
    expect(metadata).toMatchObject({
      connector: "file-replay",
      browserCapture: "skipped",
      wrap: "on",
      files: {
        html: join(dir, "terminal.html"),
        text: join(dir, "terminal.txt"),
      },
    })
  })

  test("#given ANSI color and style escapes #when rendering #then HTML preserves terminal styling while text stays plain", async () => {
    // given
    const dir = makeTempDir()
    const transcript = join(dir, "ansi-capture.txt")
    writeFileSync(transcript, "\u001b[31mred\u001b[0m \u001b[1;32mbold green\u001b[0m\n", "utf8")

    // when
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        helperFilePath,
        "--title",
        "ANSI QA",
        "--from-file",
        transcript,
        "--evidence-dir",
        dir,
        "--no-browser",
      ],
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stderrText] = await Promise.all([proc.exited, new Response(proc.stderr).text()])

    // then
    expect(stderrText).toBe("")
    expect(exitCode).toBe(0)
    expect(readFileSync(join(dir, "terminal-ansi.txt"), "utf8")).toContain("\u001b[31mred")
    expect(readFileSync(join(dir, "terminal.txt"), "utf8")).toBe("red bold green\n")

    const html = readFileSync(join(dir, "terminal.html"), "utf8")
    expect(html).toContain('class="ansi-fg-red"')
    expect(html).toContain('class="ansi-bold ansi-fg-green"')
    expect(html).toContain("bold green")
  })

  test("#given inverse video with default colors #when rendering #then foreground and background swap without filter CSS", async () => {
    // given
    const dir = makeTempDir()
    const transcript = join(dir, "inverse-default.txt")
    writeFileSync(transcript, "\u001b[7m selected row \u001b[0m\n", "utf8")

    // when
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        helperFilePath,
        "--title",
        "Inverse Default QA",
        "--from-file",
        transcript,
        "--evidence-dir",
        dir,
        "--no-browser",
      ],
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stderrText] = await Promise.all([proc.exited, new Response(proc.stderr).text()])

    // then
    expect(stderrText).toBe("")
    expect(exitCode).toBe(0)

    const html = readFileSync(join(dir, "terminal.html"), "utf8")
    expect(html).toContain(
      '<span style="color: #090b10; background-color: #d8dee9"> selected row </span>',
    )
    expect(html).not.toContain("ansi-inverse")
    expect(html).not.toContain("filter: invert")
  })

  test("#given inverse video with explicit colors #when rendering #then foreground and background classes swap", async () => {
    // given
    const dir = makeTempDir()
    const transcript = join(dir, "inverse-explicit.txt")
    writeFileSync(transcript, "\u001b[31;44;7m selected \u001b[0m\n", "utf8")

    // when
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        helperFilePath,
        "--title",
        "Inverse Explicit QA",
        "--from-file",
        transcript,
        "--evidence-dir",
        dir,
        "--no-browser",
      ],
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stderrText] = await Promise.all([proc.exited, new Response(proc.stderr).text()])

    // then
    expect(stderrText).toBe("")
    expect(exitCode).toBe(0)

    const html = readFileSync(join(dir, "terminal.html"), "utf8")
    expect(html).toContain('<span class="ansi-fg-blue ansi-bg-red"> selected </span>')
  })

  test("#given inverse video is reset #when rendering #then later text uses normal colors", async () => {
    // given
    const dir = makeTempDir()
    const transcript = join(dir, "inverse-reset.txt")
    writeFileSync(transcript, "\u001b[31;44;7minverse\u001b[27m normal\u001b[0m plain\n", "utf8")

    // when
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        helperFilePath,
        "--title",
        "Inverse Reset QA",
        "--from-file",
        transcript,
        "--evidence-dir",
        dir,
        "--no-browser",
      ],
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stderrText] = await Promise.all([proc.exited, new Response(proc.stderr).text()])

    // then
    expect(stderrText).toBe("")
    expect(exitCode).toBe(0)

    const html = readFileSync(join(dir, "terminal.html"), "utf8")
    expect(html).toContain(
      '<span class="ansi-fg-blue ansi-bg-red">inverse</span><span class="ansi-fg-red ansi-bg-blue"> normal</span> plain',
    )
  })

  test("#given truecolor and OSC controls #when rendering #then colors are preserved and controls are stripped", async () => {
    // given
    const dir = makeTempDir()
    const transcript = join(dir, "truecolor-osc.txt")
    writeFileSync(
      transcript,
      [
        "\u001b[38;2;12;34;56msemicolon truecolor\u001b[0m",
        "\u001b[38:2::255:0:0mcolon truecolor\u001b[0m",
        "\u001b[38:2:0:255:0:0mcolon truecolor colorspace\u001b[0m",
        "\u001b]8;;https://example.com\u0007visible label\u001b]8;;\u0007",
      ].join("\n"),
      "utf8",
    )

    // when
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        helperFilePath,
        "--title",
        "Truecolor OSC QA",
        "--from-file",
        transcript,
        "--evidence-dir",
        dir,
        "--no-browser",
      ],
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stderrText] = await Promise.all([proc.exited, new Response(proc.stderr).text()])

    // then
    expect(stderrText).toBe("")
    expect(exitCode).toBe(0)
    expect(readFileSync(join(dir, "terminal.txt"), "utf8")).toBe(
      "semicolon truecolor\ncolon truecolor\ncolon truecolor colorspace\nvisible label",
    )

    const html = readFileSync(join(dir, "terminal.html"), "utf8")
    expect(html).toContain('style="color: rgb(12, 34, 56)"')
    expect(html).toContain('<span style="color: rgb(255, 0, 0)">colon truecolor</span>')
    expect(html).toContain('<span style="color: rgb(255, 0, 0)">colon truecolor colorspace</span>')
    expect(html).toContain("visible label")
    expect(html).not.toContain("\u001b]")
    expect(html).not.toContain("https://example.com")
  })

  test("#given a very long line #when rendering with defaults #then wrapping is enabled and recorded", async () => {
    // given
    const dir = makeTempDir()
    const transcript = join(dir, "long-line.txt")
    writeFileSync(transcript, `${"x".repeat(260)}\n`, "utf8")

    // when
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        helperFilePath,
        "--title",
        "Long Line QA",
        "--from-file",
        transcript,
        "--evidence-dir",
        dir,
        "--no-browser",
      ],
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stderrText] = await Promise.all([proc.exited, new Response(proc.stderr).text()])

    // then
    expect(stderrText).toBe("")
    expect(exitCode).toBe(0)

    const html = readFileSync(join(dir, "terminal.html"), "utf8")
    expect(html).toContain("white-space: pre-wrap")
    expect(html).toContain("overflow-wrap: anywhere")

    const metadata: unknown = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"))
    expect(metadata).toMatchObject({
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
    expect(stdoutText).toContain("tmux-backed PTY connector")
    expect(stdoutText).toContain("PNG")
  })

  test("#given QA skill guidance #when TUI visual evidence is required #then shared guidance points at the web terminal helper", () => {
    // given
    const repo = new URL("..", import.meta.url)
    const guidedFiles = [
      ".agents/skills/opencode-qa/SKILL.md",
      ".agents/skills/opencode-qa/references/tui-tmux.md",
      ".agents/skills/codex-qa/SKILL.md",
      ".agents/skills/codex-qa/references/logging-debug.md",
      "docs/reference/web-terminal-visual-qa.md",
      "packages/shared-skills/skills/visual-qa/SKILL.md",
      "packages/shared-skills/skills/start-work/SKILL.md",
      "packages/omo-codex/plugin/components/start-work-continuation/directive.md",
      "packages/omo-codex/plugin/components/ulw-loop/skills/ulw-loop/references/full-workflow.md",
      "packages/omo-codex/plugin/components/ulw-loop/directive.md",
      "packages/omo-codex/plugin/components/ultrawork/directive.md",
      "packages/prompts-core/prompts/ultrawork/codex.md",
    ] as const

    // when
    const contents = guidedFiles.map((path) => ({
      path,
      text: readFileSync(new URL(path, repo), "utf8"),
    }))

    // then
    for (const content of contents) {
      expect(content.text, `${content.path} must reference the web terminal helper`).toContain(
        "script/qa/web-terminal-visual-qa.mjs",
      )
    }
    expect(contents.map((content) => content.text).join("\n")).toContain("TUI visual")
  })

  test("#given PR visual evidence docs #when attaching screenshots #then GitHub user attachment guidance is discoverable", () => {
    // given
    const repo = new URL("..", import.meta.url)
    const attachmentDoc = readFileSync(new URL("docs/reference/github-attachment-upload.md", repo), "utf8")
    const pointerFiles = [
      "docs/AGENTS.md",
      "docs/reference/web-terminal-visual-qa.md",
      "packages/shared-skills/skills/git-master/SKILL.md",
      ".agents/skills/work-with-pr/SKILL.md",
      ".opencode/skills/work-with-pr/SKILL.md",
    ] as const

    // when
    const pointers = pointerFiles.map((path) => ({
      path,
      text: readFileSync(new URL(path, repo), "utf8"),
    }))

    // then
    expect(attachmentDoc).toContain("/upload/policies/assets")
    expect(attachmentDoc).toContain("asset_upload_authenticity_token")
    expect(attachmentDoc).toContain("https://github.com/user-attachments/assets/<uuid>")
    expect(attachmentDoc).toContain("Never use GitHub Releases")
    expect(attachmentDoc).toContain("Never use external image hosters")
    expect(attachmentDoc).toContain("Do not print cookies")
    for (const pointer of pointers) {
      expect(pointer.text, `${pointer.path} must point at attachment upload guidance`).toContain(
        "docs/reference/github-attachment-upload.md",
      )
    }
  })
})
