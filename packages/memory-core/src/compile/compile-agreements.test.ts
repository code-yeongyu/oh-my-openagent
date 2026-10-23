import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { AGREEMENTS_PATH } from "../agreements/types"
import { GitMemoryRepo } from "../git"
import { removeTree } from "../../../../test-support/remove-tree"
import { compileMemoryBlockAtRevision } from "./compile"

const LEDGER = [
  "---",
  "description: Agreements",
  "---",
  "",
  "- [project] Run bun test before claiming done. <!-- id: 7b1d000000; by: agent; n: 1; since: 2026-10-20; last: 2026-10-20; status: active -->",
  "- [global] Never filter the message monitor output. <!-- id: 3f9a1c0b2e; by: human; n: 3; since: 2026-10-14; last: 2026-10-21; status: needs-human -->",
  "",
].join("\n")
const roots: string[] = []

setDefaultTimeout(process.platform === "win32" ? 20_000 : 5_000)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function repoWith(files: Record<string, string>) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "compile-agreements-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "memory"), agentId: "agent-one" })
  await repo.init({ seedFiles: Object.entries(files).map(([relativePath, content]) => ({ relativePath, content })) })
  return repo
}

describe("compiled memory block: the <agreements> section (prompt-byte contract)", () => {
  it("#given a committed ledger #when compiled #then one <agreements> section sits between </self> and <memory>, human first, with counts and the flag, and no raw ledger node in <memory>", async () => {
    // given
    const repo = await repoWith({
      "system/persona.md": "---\ndescription: Persona\n---\n\nI am careful.\n",
      "system/human.md": "---\ndescription: Human\n---\n\nThe person.\n",
      [AGREEMENTS_PATH]: LEDGER,
    })

    // when
    const block = await compileMemoryBlockAtRevision(repo, await repo.head(), { agentId: "agent-one" })

    // then
    const selfEnd = block.indexOf("\n</self>\n")
    const open = block.indexOf("\n<agreements>\n")
    const memory = block.indexOf("\n<memory>\n")
    expect(selfEnd).toBeGreaterThan(-1)
    expect(open).toBeGreaterThan(selfEnd)
    expect(memory).toBeGreaterThan(open)
    expect(block.split("<agreements>")).toHaveLength(2)
    const section = block.slice(open, block.indexOf("</agreements>"))
    const lines = section.split("\n").filter((line) => line.startsWith("- ["))
    expect(lines).toEqual([
      "- [global] [human] [broken x3] NEEDS-HUMAN: Never filter the message monitor output.",
      "- [project] [agent] [broken x1] Run bun test before claiming done.",
    ])
    expect(block).not.toContain("<!-- id:")
  })

  it("#given an unchanged revision #when compiled twice #then the bytes are identical", async () => {
    // given
    const repo = await repoWith({ [AGREEMENTS_PATH]: LEDGER })
    const head = await repo.head()

    // when
    const first = await compileMemoryBlockAtRevision(repo, head, { agentId: "agent-one" })
    const second = await compileMemoryBlockAtRevision(repo, head, { agentId: "agent-one" })

    // then
    expect(second).toBe(first)
  })
})
