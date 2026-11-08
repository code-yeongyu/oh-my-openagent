import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { validateCompletion } from "./completion-validation"
import { LINK_TEST_TIMEOUT_MS, cleanupLinkFixtures, INVALID, PEM, commitAll, git, linkFixture as fixture, note, put, read } from "./completion-links.test-support"
import { finalizeReflectionWorktree } from "./worktree"

setDefaultTimeout(LINK_TEST_TIMEOUT_MS)
afterEach(cleanupLinkFixtures)

describe("only the gate's own link repair is exempt from a targeted run's scope (#12642)", () => {
  it("#given a targeted run whose second commit claims to be a link repair #when finalized #then its out-of-target edit is refused", async () => {
    // given
    const worktree = await fixture({
      "reference/target.md": note("Target", "t\n"),
      "system/persona.md": note("Persona", "who I am\n"),
    })
    await put(worktree.dir, "reference/target.md", note("Target", "t2\n"))
    await commitAll(worktree.dir, "chore(dream): maintain the target")
    await put(worktree.dir, "system/persona.md", note("Persona", "rewritten\n"))
    await git(worktree.dir, "add", "-A")
    await git(worktree.dir, "-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "commit", "-qm",
      "chore(memory): repoint links to removed notes\n\nOmo-Link-Repair: 1")

    // when
    const result = await finalizeReflectionWorktree(worktree, {
      mode: "auto",
      summary: "targeted",
      allowedPaths: ["reference/target.md"],
      withWriterLock: async (operation) => operation(),
    })

    // then
    expect(result.status).toBe("failed")
    expect(result.detail).toContain("outside its target")
    expect(await read(worktree.parent.dir, "system/persona.md")).toContain("who I am")
  })

  it("#given a targeted run removing its target that a note with secret-like text links to #when finalized #then the run lands and that note is left untouched", async () => {
    // given
    const legacy = note("Legacy", `See [[reference/target.md|the target]].\n\n${PEM}`)
    const worktree = await fixture({ "reference/target.md": note("Target", "t\n"), "reference/legacy.md": legacy })
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
    expect(result.detail ?? "").not.toContain("reference/legacy.md")
    expect(await read(worktree.parent.dir, "reference/legacy.md")).toBe(legacy)
  })

  it("#given a non-UTF-8 note and a UTF-8 note linking a removed note #when validated #then only the UTF-8 note is repaired and the other keeps its bytes", async () => {
    // given
    const worktree = await fixture({ "reference/x.md": note("X", "x\n"), "reference/user.md": note("User", "[[reference/x.md|x]]\n") })
    const latin1 = Buffer.concat([Buffer.from(note("Legacy", "Caf")), Buffer.from([0xe9]), Buffer.from(" see [[reference/x.md|x]].\n")])
    await writeFile(join(worktree.dir, "reference/legacy.md"), latin1)
    await git(worktree.dir, "rm", "-q", "reference/x.md")
    await commitAll(worktree.dir, "chore(dream): retire x")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    expect(result.linkRepairs).toEqual(["reference/user.md"])
    expect(await read(worktree.dir, "reference/user.md")).not.toContain("[[reference/x.md")
    expect((await readFile(join(worktree.dir, "reference/legacy.md"))).equals(latin1)).toBe(true)
  })

  it("#given a run whose link repair commit exists #when the same branch is validated twice #then both results are equal and name the repair", async () => {
    // given
    const worktree = await fixture({ "reference/x.md": note("X", "x\n"), "reference/user.md": note("User", "[[reference/x.md|x]]\n") })
    await git(worktree.dir, "rm", "-q", "reference/x.md")
    await commitAll(worktree.dir, "chore(dream): retire x")

    // when
    const first = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    const second = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(first.status).toBe("valid")
    if (first.status !== "valid") return
    expect(first.linkRepairs).toEqual(["reference/user.md"])
    expect(second).toEqual(first)
  })

  it("#given a run with a link repair and a dropped entry #when the same branch is validated twice #then both results keep the repair and the drop", async () => {
    // given
    const worktree = await fixture({ "reference/x.md": note("X", "x\n"), "reference/user.md": note("User", "[[reference/x.md|x]]\n") })
    await git(worktree.dir, "rm", "-q", "reference/x.md")
    await put(worktree.dir, "reference/bad.md", note(INVALID, "bad\n"))
    await commitAll(worktree.dir, "chore(dream): retire x")

    // when
    const first = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    const second = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(first.status).toBe("valid")
    if (first.status !== "valid") return
    expect(first.linkRepairs).toEqual(["reference/user.md"])
    expect(first.dropped?.map((entry) => entry.path)).toEqual(["reference/bad.md"])
    expect(second).toEqual(first)
  })
})
