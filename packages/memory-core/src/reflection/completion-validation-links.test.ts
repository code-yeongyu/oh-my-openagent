import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { auditMemoryRepo } from "../audit/audit"
import { validateCompletion } from "./completion-validation"
import { LINK_TEST_TIMEOUT_MS, cleanupLinkFixtures, INVALID, commitAll, git, linkFixture as fixture, note, put, read } from "./completion-links.test-support"
import { finalizeReflectionWorktree } from "./worktree"

setDefaultTimeout(LINK_TEST_TIMEOUT_MS)
afterEach(cleanupLinkFixtures)

describe("reflection completion repoints links to the notes a run removed (#12642)", () => {
  it("#given a dream that archives a fact ledger other notes link to #when validated #then no link dangles and each points at the archive", async () => {
    // given
    const worktree = await fixture({
      "ARCHIVE.md": "# Archive\n",
      "notes/facts/2026-10.md": note("Explicit facts for 2026-10", "- [2026-10-01] The build uses Bun.\n"),
      "notes/facts/2026-10-topic.md": note("Build topic", "See [[notes/facts/2026-10.md]] and [the ledger](2026-10.md#top).\n"),
    })
    await git(worktree.dir, "rm", "-q", "notes/facts/2026-10.md")
    await put(worktree.dir, "ARCHIVE.md", "# Archive\n\n- 2026-10 (notes/facts/2026-10.md): the build uses Bun.\n")
    await commitAll(worktree.dir, "chore(dream): archive oversized October fact ledger")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    expect(result.changedPaths).toContain("notes/facts/2026-10-topic.md")
    expect((await auditMemoryRepo(worktree.dir)).counts.link_dangling).toBe(0)
    const topic = await read(worktree.dir, "notes/facts/2026-10-topic.md")
    expect(topic).toContain("[[ARCHIVE.md|notes/facts/2026-10.md (archived)]]")
    expect(topic).toContain("[the ledger](../../ARCHIVE.md)")
    expect(await git(worktree.dir, "status", "--porcelain")).toBe("")
  })

  it("#given a dream that moves a note #when validated #then wiki and markdown links follow it, keeping their anchors and aliases", async () => {
    // given
    const worktree = await fixture({
      "reference/old.md": note("Old home", "content\n"),
      "notes/user.md": note("User", "[[reference/old|the note]], [[reference/old.md#part]], [x](../reference/old.md#sec).\n"),
    })
    await mkdir(join(worktree.dir, "reference/new"), { recursive: true })
    await git(worktree.dir, "mv", "reference/old.md", "reference/new/home.md")
    await commitAll(worktree.dir, "chore(dream): move old note")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    expect((await auditMemoryRepo(worktree.dir)).counts.link_dangling).toBe(0)
    expect(await read(worktree.dir, "notes/user.md")).toContain(
      "[[reference/new/home|the note]], [[reference/new/home.md#part]], [x](../reference/new/home.md#sec).",
    )
  })

  it("#given a dream that deletes a note without archiving it #when validated #then links become plain text and quoted examples stay as written", async () => {
    // given
    const worktree = await fixture({
      "reference/junk.md": note("Junk", "junk\n"),
      "notes/user.md": note("User", "Gone: [[reference/junk.md|junk]] and [j](../reference/junk.md).\n\n```\n[[reference/junk.md]]\n```\n"),
    })
    await git(worktree.dir, "rm", "-q", "reference/junk.md")
    await commitAll(worktree.dir, "chore(dream): delete junk")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    expect(await read(worktree.dir, "notes/user.md")).toContain("Gone: junk and j.\n\n```\n[[reference/junk.md]]\n```\n")
  })

  it("#given a link that already dangled before the run #when validated #then the run leaves it to the audit", async () => {
    // given
    const worktree = await fixture({
      "notes/user.md": note("User", "[[reference/never-existed.md]]\n"),
      "notes/other.md": note("Other", "x\n"),
    })
    await put(worktree.dir, "notes/other.md", note("Other", "y\n"))
    await commitAll(worktree.dir, "chore(dream): edit")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    expect(result.changedPaths).toEqual(["notes/other.md"])
    expect(await read(worktree.dir, "notes/user.md")).toContain("[[reference/never-existed.md]]")
  })

  it("#given a renamed note whose new copy the screen drops #when validated #then links keep pointing at the restored note and none dangles", async () => {
    // given
    const worktree = await fixture({
      "reference/old.md": note("Old", "content\n"),
      "reference/user.md": note("User", "See [[reference/old.md]].\n"),
    })
    await git(worktree.dir, "mv", "reference/old.md", "reference/new.md")
    await put(worktree.dir, "reference/new.md", "---\ndescription: Old\n# c\n---\n\ncontent\n")
    await commitAll(worktree.dir, "chore(dream): rename old")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("no_changes")
    expect(await read(worktree.dir, "reference/user.md")).toContain("See [[reference/old.md]].")
    expect((await auditMemoryRepo(worktree.dir)).counts.link_dangling).toBe(0)
  })

  it("#given a run whose linking note the screen drops #when the same tip is validated twice #then the tip, paths and dropped report are identical", async () => {
    // given
    const worktree = await fixture({
      "reference/x.md": note("X", "x\n"),
      "reference/y.md": note("Y", "Links [[reference/x.md]].\n"),
      "reference/z.md": note("Z", "z\n"),
    })
    await git(worktree.dir, "rm", "-q", "reference/x.md")
    await put(worktree.dir, "reference/y.md", note(INVALID, "Links [[reference/x.md]].\n"))
    await put(worktree.dir, "reference/z.md", note("Z", "z2\n"))
    await commitAll(worktree.dir, "chore(dream): drop x")

    // when
    const first = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    const second = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(first.status).toBe("valid")
    if (first.status !== "valid") return
    expect(first.dropped?.map((entry) => entry.path)).toEqual(["reference/y.md"])
    expect(second).toEqual(first)
  })

  it("#given one run that archives a ledger and forgets another note #when validated #then only the archived path links to ARCHIVE.md", async () => {
    // given
    const worktree = await fixture({
      "ARCHIVE.md": "# Archive\n",
      "notes/facts/2026-01.md": note("Explicit facts for 2026-01", "- [2026-01-02] Old fact.\n"),
      "notes/secret-project.md": note("Secret", "forget me\n"),
      "notes/user.md": note("User", "[[notes/facts/2026-01.md]] and [[notes/secret-project.md|that project]].\n"),
    })
    await git(worktree.dir, "rm", "-q", "notes/facts/2026-01.md", "notes/secret-project.md")
    await put(worktree.dir, "ARCHIVE.md", "# Archive\n\n- 2026-01 (notes/facts/2026-01.md): one old fact.\n")
    await commitAll(worktree.dir, "chore(dream): archive January, forget the project")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    expect(await read(worktree.dir, "notes/user.md")).toContain(
      "[[ARCHIVE.md|notes/facts/2026-01.md (archived)]] and that project.\n",
    )
  })

  it("#given a run that also has an entry the screen drops #when its links are repaired #then the run's own commit subject survives", async () => {
    // given
    const worktree = await fixture({
      "reference/x.md": note("X", "x\n"),
      "reference/user.md": note("User", "[[reference/x.md|x]]\n"),
    })
    await git(worktree.dir, "rm", "-q", "reference/x.md")
    await put(worktree.dir, "reference/bad.md", note(INVALID, "bad\n"))
    await commitAll(worktree.dir, "chore(dream): retire x")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    expect(await git(worktree.dir, "log", "--format=%s", `${worktree.baseSha}..HEAD`)).toContain("chore(dream): retire x")
    expect(await read(worktree.dir, "reference/user.md")).toContain("x\n")
  })

  it("#given a moved note with its own relative markdown links #when validated #then they resolve from its new folder", async () => {
    // given
    const worktree = await fixture({
      "reference/old.md": note("Old home", "Back to [the user](../notes/user.md#top).\n"),
      "notes/user.md": note("User", "u\n"),
    })
    await mkdir(join(worktree.dir, "reference/new"), { recursive: true })
    await git(worktree.dir, "mv", "reference/old.md", "reference/new/home.md")
    await commitAll(worktree.dir, "chore(dream): move old note")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    expect(await read(worktree.dir, "reference/new/home.md")).toContain("Back to [the user](../../notes/user.md#top).")
    expect((await auditMemoryRepo(worktree.dir)).counts.link_dangling).toBe(0)
  })

  it("#given a targeted dream that removes its own linked target #when finalized #then the gate's link repairs count as part of the target run", async () => {
    // given
    const worktree = await fixture({
      "reference/target.md": note("Target", "t\n"),
      "reference/user.md": note("User", "[[reference/target.md|the target]]\n"),
    })
    await git(worktree.dir, "rm", "-q", "reference/target.md")
    await commitAll(worktree.dir, "chore(dream): retire the target")

    // when
    const result = await finalizeReflectionWorktree(worktree, {
      mode: "auto",
      summary: "targeted",
      allowedPaths: ["reference/target.md"],
      withWriterLock: async (operation) => operation(),
    })

    // then
    expect(result.status).toBe("merged")
    expect(await read(worktree.parent.dir, "reference/user.md")).toContain("the target\n")
  })
})
