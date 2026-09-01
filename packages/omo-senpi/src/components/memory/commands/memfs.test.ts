import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CONFIG_KEY, createNodeGitExec } from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import {
  fakeCommandContext,
  fakeDeps,
  invoke,
  seededRepo,
  tempIdentity,
  type FakeCommandContext,
} from "./commands.test-support"
import { registerMemfsCommand } from "./memfs"

const tempDirs: string[] = []

afterEach(async () => {
  // Windows releases git's handles slightly after the child exits, so a bare recursive remove
  // throws EBUSY. Retry the unlink instead of failing an otherwise passing case.
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })),
  )
})

// These cases drive real git subprocesses (init, commit, push); the 5s default is not a budget
// they fit on a loaded Windows runner.
setDefaultTimeout(process.platform === "win32" ? 30_000 : 5_000)

const SEEDS = [
  { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nseeded persona\n" },
]

async function harness(options: { readonly seeded?: boolean; readonly hasUI?: boolean } = {}): Promise<{
  identity: Awaited<ReturnType<typeof tempIdentity>>["identity"]
  pi: MemoryFakeExtensionAPI
  ctx: FakeCommandContext
}> {
  const { root, identity } = await tempIdentity()
  tempDirs.push(root)
  if (options.seeded !== false) await seededRepo(identity, SEEDS)
  const pi = new MemoryFakeExtensionAPI()
  registerMemfsCommand(pi, fakeDeps(identity))
  return { identity, pi, ctx: fakeCommandContext({ hasUI: options.hasUI ?? true }) }
}

async function backupNames(root: string): Promise<string[]> {
  const entries = await readdir(join(root, "agents", "test-identity"))
  return entries.filter((entry) => entry.startsWith("memory-backup-"))
}

describe("/memfs status", () => {
  test("#given a clean repo #when status runs #then HEAD and a clean tree are reported at info level", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memfs", "status", ctx)

    // then
    expect(text).toContain("HEAD:")
    expect(text).toContain("Working tree: clean")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })

  test("#given uncommitted changes #when status runs #then the dirty state is reported as a warning", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    await writeFile(join(identity.identityPaths.repo, "system", "persona.md"), "---\ndescription: Persona\n---\nedited\n")

    // when
    const text = await invoke(pi, "memfs", "status", ctx)

    // then
    expect(text).toContain("Working tree: dirty")
    expect(text).toContain("uncommitted changes")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("warning")
  })

  test("#given no repository #when status runs #then an actionable error is returned", async () => {
    // given
    const { pi, ctx } = await harness({ seeded: false })

    // when
    const text = await invoke(pi, "memfs", "status", ctx)

    // then
    expect(text).toContain("no memory repository")
    expect(text).toContain("/memfs init")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})

describe("/memfs init", () => {
  test("#given no repository #when init runs #then the repository is created", async () => {
    // given
    const { identity, pi, ctx } = await harness({ seeded: false })

    // when
    const text = await invoke(pi, "memfs", "init", ctx)

    // then
    expect(text).toContain("initialized memory repository")
    expect(existsSync(join(identity.identityPaths.repo, ".git"))).toBe(true)
  })

  test("#given an existing repository #when init runs #then it reports idempotently without error", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memfs", "init", ctx)

    // then
    expect(text).toContain("already initialized")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })

  test("#given an unbound session with a config-resolved identity #when init runs #then it still initializes", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const pi = new MemoryFakeExtensionAPI()
    registerMemfsCommand(pi, fakeDeps(undefined, { resolveIdentity: () => identity }))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "memfs", "init", ctx)

    // then
    expect(text).toContain("initialized memory repository")
    expect(existsSync(join(identity.identityPaths.repo, ".git"))).toBe(true)
  })
})

describe("/memfs sync", () => {
  test("#given no configured mirror #when sync runs #then an actionable error names /memory-repository", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memfs", "sync", ctx)

    // then
    expect(text).toContain("no memory repository mirror configured")
    expect(text).toContain("/memory-repository set")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given a reachable mirror #when sync runs #then the push is reported as successful", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const repo = await seededRepo(identity, SEEDS)
    // Windows hands back an 8.3 short path (RUNNER~1) with backslashes; git only resolves the
    // mirror as a remote when the configured URL is canonical and slash-separated.
    const bare = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-mirror-")))
    tempDirs.push(bare)
    await createNodeGitExec().run(["init", "--bare", bare], { cwd: bare, timeoutMs: 30_000 })
    await repo.configSet(CONFIG_KEY, `file://${bare.replaceAll("\\", "/")}`)
    const pi = new MemoryFakeExtensionAPI()
    registerMemfsCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "memfs", "sync", ctx)

    // then
    expect(text).toContain("pushed")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })
})

describe("/memfs repair", () => {
  test("#given a skill missing name frontmatter #when repair runs #then hooks are reinstalled and the skill is repaired", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    await mkdir(join(identity.identityPaths.repo, "skills", "commit"), { recursive: true })
    await writeFile(join(identity.identityPaths.repo, "skills", "commit", "SKILL.md"), "---\ndescription: x\n---\n")

    // when
    const text = await invoke(pi, "memfs", "repair", ctx)

    // then
    expect(text).toContain("skills/commit/SKILL.md")
    expect(text).toContain("hooks")
    expect(existsSync(join(identity.identityPaths.repo, ".git", "hooks", "pre-commit"))).toBe(true)
  })
})

describe("/memfs reset", () => {
  test("#given interactive confirmation #when reset runs #then a backup is taken first and the repo is re-initialized", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const repo = await seededRepo(identity, SEEDS)
    const headBefore = await repo.head()
    const pi = new MemoryFakeExtensionAPI()
    registerMemfsCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext({ hasUI: true })

    // when
    const text = await invoke(pi, "memfs", "reset", ctx)

    // then
    expect(ctx.ui.confirms).toHaveLength(1)
    const backups = await backupNames(root)
    expect(backups).toHaveLength(1)
    expect(existsSync(join(root, "agents", "test-identity", backups[0] ?? "", "system", "persona.md"))).toBe(true)
    expect(text).toContain("backup")
    expect(existsSync(join(identity.identityPaths.repo, "system", "persona.md"))).toBe(false)
    expect(await repo.head()).not.toBe(headBefore)
  })

  test("#given a declined confirmation #when reset runs #then nothing is destroyed and no backup is written", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    await seededRepo(identity, SEEDS)
    const pi = new MemoryFakeExtensionAPI()
    registerMemfsCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext({ hasUI: true })
    ctx.ui.confirmResult = false

    // when
    const text = await invoke(pi, "memfs", "reset", ctx)

    // then
    expect(text).toContain("aborted")
    expect(await backupNames(root)).toHaveLength(0)
    expect(existsSync(join(identity.identityPaths.repo, "system", "persona.md"))).toBe(true)
  })

  test("#given a noninteractive session without --force #when reset runs #then it refuses and preserves the repo", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    await seededRepo(identity, SEEDS)
    const pi = new MemoryFakeExtensionAPI()
    registerMemfsCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext({ hasUI: false })

    // when
    const text = await invoke(pi, "memfs", "reset", ctx)

    // then
    expect(text).toContain("--force")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
    expect(await backupNames(root)).toHaveLength(0)
    expect(existsSync(join(identity.identityPaths.repo, "system", "persona.md"))).toBe(true)
  })

  test("#given a noninteractive session with --force #when reset runs #then the repo is backed up and reset", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    await seededRepo(identity, SEEDS)
    const pi = new MemoryFakeExtensionAPI()
    registerMemfsCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext({ hasUI: false })

    // when
    const text = await invoke(pi, "memfs", "reset --force", ctx)

    // then
    expect(text).toContain("reset complete")
    expect(await backupNames(root)).toHaveLength(1)
    expect(existsSync(join(identity.identityPaths.repo, "system", "persona.md"))).toBe(false)
  })
})

describe("/memfs dispatch", () => {
  test("#given no subcommand #when invoked #then usage lists every subcommand", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memfs", "", ctx)

    // then
    expect(text).toContain("usage: /memfs")
    for (const sub of ["status", "init", "sync", "repair", "reset", "backup", "restore", "diff", "tokens"]) {
      expect(text).toContain(sub)
    }
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given an unknown subcommand #when invoked #then an actionable error is returned", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memfs", "frobnicate", ctx)

    // then
    expect(text).toContain("unknown /memfs subcommand: frobnicate")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})
