import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo } from "./index"

const KOREAN_CARD = "people/김철수/card.md"
const AUTHOR = { agentId: "agent-one", authorName: "홍길동", authorEmail: "hong@example.com" }
const tempDirs: string[] = []

async function repoWithKoreanCard() {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-git-unicode-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId })
  await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "initial\n" }] })
  await mkdir(join(dir, "people", "김철수"), { recursive: true })
  await writeFile(join(dir, KOREAN_CARD), "---\ndescription: Person - 김철수\n---\nIDENTITY: QA 리드\n")
  return repo
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => undefined)
  }
})

describe("GitMemoryRepo non-ASCII paths", () => {
  it("#given an untracked Korean-named file #when status is read #then the porcelain path is raw UTF-8, never a C-quoted octal escape", async () => {
    // given
    const repo = await repoWithKoreanCard()
    // when
    const porcelain = await repo.status()
    // then
    expect(porcelain).toContain(KOREAN_CARD)
    expect(porcelain).not.toContain("\\352")
  })

  it("#given a Korean-named memory file #when commitWrite targets exactly that path #then the commit lands instead of a false dirty-repo rejection", async () => {
    // given
    const repo = await repoWithKoreanCard()
    const before = await repo.head()
    // when
    await repo.commitWrite([KOREAN_CARD], "remember 김철수", AUTHOR)
    // then
    expect(await repo.head()).not.toBe(before)
    expect(await repo.lsTree("HEAD")).toContain(KOREAN_CARD)
    expect((await repo.status()).trim()).toBe("")
  })
})
