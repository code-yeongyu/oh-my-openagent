import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { validateCompletion } from "./completion-validation"
import {
  LINK_TEST_TIMEOUT_MS,
  cleanupLinkFixtures,
  commitAll,
  git,
  linkFixture as fixture,
  note,
  put,
  read,
} from "./completion-links.test-support"

setDefaultTimeout(LINK_TEST_TIMEOUT_MS)
afterEach(cleanupLinkFixtures)

describe("link repair keeps each link's original target (#12642)", () => {
  it("#given a moved note whose relative link also resolves from its new folder #when validated #then it keeps pointing at the original note", async () => {
    // given
    const worktree = await fixture({
      "a/x.md": note("X", "[the index](index.md)\n"),
      "a/index.md": note("A index", "a\n"),
      "b/index.md": note("B index", "b\n"),
    })
    await mkdir(join(worktree.dir, "b"), { recursive: true })
    await git(worktree.dir, "mv", "a/x.md", "b/x.md")
    await commitAll(worktree.dir, "chore(dream): move x")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    expect(await read(worktree.dir, "b/x.md")).toContain("[the index](../a/index.md)")
  })

  it("#given an archive entry that names only the ledger's file name #when validated #then links to it point at the archive", async () => {
    // given
    const worktree = await fixture({
      "ARCHIVE.md": "# Archive\n",
      "notes/facts/2026-01.md": note("Explicit facts for 2026-01", "- [2026-01-02] Old fact.\n"),
      "notes/user.md": note("User", "[[notes/facts/2026-01.md]]\n"),
    })
    await git(worktree.dir, "rm", "-q", "notes/facts/2026-01.md")
    await put(worktree.dir, "ARCHIVE.md", "# Archive\n\n- 2026-01.md: one old fact.\n")
    await commitAll(worktree.dir, "chore(dream): archive January")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    expect(await read(worktree.dir, "notes/user.md")).toContain("[[ARCHIVE.md|notes/facts/2026-01.md (archived)]]")
  })

  it("#given an archive entry naming a different extension of a deleted note #when validated #then the link becomes plain text", async () => {
    // given
    const worktree = await fixture({
      "ARCHIVE.md": "# Archive\n",
      "notes/secret.md": note("Secret", "forget me\n"),
      "notes/user.md": note("User", "[[notes/secret.md|that note]] and [[notes/secret.md|again]]\n"),
    })
    await git(worktree.dir, "rm", "-q", "notes/secret.md")
    await put(worktree.dir, "ARCHIVE.md", "# Archive\n\n- moved notes/secret.mdx and notes/secret.txt elsewhere.\n")
    await commitAll(worktree.dir, "chore(dream): forget the secret note")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    expect(await read(worktree.dir, "notes/user.md")).toContain("that note and again\n")
  })
})
