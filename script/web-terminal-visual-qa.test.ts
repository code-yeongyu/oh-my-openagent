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
      files: {
        html: join(dir, "terminal.html"),
        text: join(dir, "terminal.txt"),
      },
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
