import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  commandIndexToCommandInfos,
  type CommandIndexEntry,
} from "./command-index-cache"

const TEST_DIR = join(tmpdir(), `command-index-cache-test-${randomUUID()}`)

describe("command-index-cache", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("converts cached index entries into CommandInfo stubs with lazy body loading", async () => {
    // given
    const commandsDir = join(TEST_DIR, "commands")
    mkdirSync(commandsDir, { recursive: true })
    const commandPath = join(commandsDir, "publish.md")
    writeFileSync(
      commandPath,
      `---
description: Publish the package
argument-hint: patch
---
echo \"publishing\"
`,
    )

    const entries: CommandIndexEntry[] = [
      {
        name: "publish",
        scope: "opencode-project",
        path: commandPath,
        metadata: {
          name: "publish",
          description: "Publish the package",
          argumentHint: "patch",
          model: "gpt-4o-mini",
          agent: "oracle",
          subtask: false,
        },
      },
    ]

    // when
    const infos = commandIndexToCommandInfos(entries)

    // then
    expect(infos).toHaveLength(1)
    expect(infos[0]?.content).toBe("")
    expect(infos[0]?.lazyContentLoader).toBeDefined()

    const body = await infos[0]!.lazyContentLoader!.load()
    expect(body).toContain('echo "publishing"')
  })
})

