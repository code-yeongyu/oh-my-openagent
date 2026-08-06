import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("web terminal visual QA guidance", () => {
  test("#given QA skill guidance #when TUI visual evidence is required #then central guidance owns helper details", () => {
    // given
    const repo = new URL("..", import.meta.url)
    const centralDoc = readFileSync(new URL("docs/reference/web-terminal-visual-qa.md", repo), "utf8")
    const pointerFiles = [
      ".agents/skills/opencode-qa/SKILL.md",
      ".agents/skills/codex-qa/SKILL.md",
    ] as const

    // when
    const pointers = pointerFiles.map((path) => ({
      path,
      text: readFileSync(new URL(path, repo), "utf8"),
    }))

    // then
    expect(centralDoc).toContain("script/qa/web-terminal-visual-qa.mjs")
    expect(centralDoc).toContain("--redact")
    expect(centralDoc).toContain("--redact-regex")
    expect(centralDoc).toContain("raw --command")
    for (const pointer of pointers) {
      expect(pointer.text, `${pointer.path} must point at central terminal evidence guidance`).toContain(
        "docs/reference/web-terminal-visual-qa.md",
      )
    }
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
