import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import {
  fakeCommandContext,
  fakeDeps,
  invoke,
  seededRepo,
  tempIdentity,
  type FakeCommandContext,
  type FakeDeps,
} from "./commands.test-support"
import { backupTimestamp } from "./backup"
import { registerMemfsCommand } from "./memfs"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

const SEEDS = [
  { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nseeded persona\n" },
]

interface Harness {
  readonly root: string
  readonly identityRoot: string
  readonly repoDir: string
  readonly pi: MemoryFakeExtensionAPI
  readonly ctx: FakeCommandContext
  readonly deps: FakeDeps
}

async function harness(options: { readonly hasUI?: boolean } = {}): Promise<Harness> {
  const { root, identity } = await tempIdentity()
  tempDirs.push(root)
  await seededRepo(identity, SEEDS)
  const deps = fakeDeps(identity)
  const pi = new MemoryFakeExtensionAPI()
  registerMemfsCommand(pi, deps)
  return {
    root,
    identityRoot: join(root, "agents", "test-identity"),
    repoDir: identity.identityPaths.repo,
    pi,
    ctx: fakeCommandContext({ hasUI: options.hasUI ?? true }),
    deps,
  }
}

async function backupNames(identityRoot: string): Promise<string[]> {
  const entries = await readdir(identityRoot)
  return entries.filter((entry) => entry.startsWith("memory-backup-")).sort()
}

describe("/memfs backup", () => {
  test("#given a repository #when backup runs #then a sibling memory-backup dir holds a copy", async () => {
    // given
    const { identityRoot, pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memfs", "backup", ctx)

    // then
    const backups = await backupNames(identityRoot)
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/^memory-backup-\d{8}-\d{6}$/)
    expect(text).toContain(backups[0] ?? "")
    const copied = await readFile(join(identityRoot, backups[0] ?? "", "system", "persona.md"), "utf8")
    expect(copied).toContain("seeded persona")
  })

  test("#given a backup already exists for the same clock #when backup runs again #then the existing backup is not clobbered", async () => {
    // given
    const { identityRoot, pi, ctx, deps } = await harness()
    const stamp = backupTimestamp(deps.now?.() ?? 0)
    const existingName = `memory-backup-${stamp}`
    const existingPersona = join(identityRoot, existingName, "system", "persona.md")
    await mkdir(join(identityRoot, existingName, "system"), { recursive: true })
    await writeFile(existingPersona, "existing backup sentinel\n")

    // when
    await invoke(pi, "memfs", "backup", ctx)

    // then
    expect(await backupNames(identityRoot)).toEqual([existingName, `${existingName}-2`])
    expect(await readFile(existingPersona, "utf8")).toBe("existing backup sentinel\n")
    expect(await readFile(join(identityRoot, `${existingName}-2`, "system", "persona.md"), "utf8"))
      .toContain("seeded persona")
  })
})

describe("/memfs restore", () => {
  test("#given a named backup #when restore runs #then repo content is replaced and a safety backup is kept", async () => {
    // given
    const { identityRoot, repoDir, pi, ctx } = await harness()
    await invoke(pi, "memfs", "backup", ctx)
    const [backupName = ""] = await backupNames(identityRoot)
    await writeFile(join(repoDir, "system", "persona.md"), "---\ndescription: Persona\n---\nlocal edit\n")

    // when
    const text = await invoke(pi, "memfs", `restore ${backupName}`, ctx)

    // then
    const restored = await readFile(join(repoDir, "system", "persona.md"), "utf8")
    expect(restored).toContain("seeded persona")
    expect(text).toContain("restored")
    expect((await backupNames(identityRoot)).length).toBe(2)
  })

  test("#given no backups #when restore runs #then an actionable error is returned", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memfs", "restore", ctx)

    // then
    expect(text).toContain("no backups found")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given backups and an interactive session #when restore runs without a name #then the user selects one", async () => {
    // given
    const { identityRoot, repoDir, pi, ctx } = await harness({ hasUI: true })
    await invoke(pi, "memfs", "backup", ctx)
    const [backupName = ""] = await backupNames(identityRoot)
    ctx.ui.selectResult = backupName
    await writeFile(join(repoDir, "system", "persona.md"), "---\ndescription: Persona\n---\nlocal edit\n")

    // when
    const text = await invoke(pi, "memfs", "restore", ctx)

    // then
    expect(ctx.ui.selects).toHaveLength(1)
    expect(ctx.ui.selects[0]?.options).toContain(backupName)
    expect(text).toContain("restored")
    expect(await readFile(join(repoDir, "system", "persona.md"), "utf8")).toContain("seeded persona")
  })

  test("#given backups and a noninteractive session #when restore runs without a name #then available backups are listed", async () => {
    // given
    const { identityRoot, pi, ctx } = await harness({ hasUI: true })
    await invoke(pi, "memfs", "backup", ctx)
    const [backupName = ""] = await backupNames(identityRoot)
    const headless = fakeCommandContext({ hasUI: false })

    // when
    const text = await invoke(pi, "memfs", "restore", headless)

    // then
    expect(text).toContain("specify a backup name")
    expect(text).toContain(backupName)
    expect(headless.ui.notifications.at(-1)?.level).toBe("error")
    expect(ctx.ui.selects).toHaveLength(0)
  })

  test("#given an unknown backup name #when restore runs #then an actionable error is returned", async () => {
    // given
    const { pi, ctx } = await harness()
    await invoke(pi, "memfs", "backup", ctx)

    // when
    const text = await invoke(pi, "memfs", "restore memory-backup-19700101-000000", ctx)

    // then
    expect(text).toContain("unknown backup")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})

describe("/memfs diff", () => {
  test("#given a clean tree #when diff runs #then no changes are reported at info level", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memfs", "diff", ctx)

    // then
    expect(text).toContain("No changes.")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })

  test("#given tracked modifications #when diff runs #then the diff is returned as a warning", async () => {
    // given
    const { repoDir, pi, ctx } = await harness()
    await writeFile(join(repoDir, "system", "persona.md"), "---\ndescription: Persona\n---\nedited body\n")

    // when
    const text = await invoke(pi, "memfs", "diff", ctx)

    // then
    expect(text).toContain("system/persona.md")
    expect(text).toContain("edited body")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("warning")
  })
})

describe("/memfs tokens", () => {
  test("#given system files #when tokens runs #then a bytes/4 estimate and per-file rows render", async () => {
    // given
    const { repoDir, pi, ctx } = await harness()
    const persona = await readFile(join(repoDir, "system", "persona.md"), "utf8")
    const expected = Math.ceil(Buffer.byteLength(persona, "utf8") / 4)

    // when
    const text = await invoke(pi, "memfs", "tokens", ctx)

    // then
    expect(text).toContain(`Total: ~${expected} tokens`)
    expect(text).toContain("system/persona.md")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })

  test("#given no repository #when tokens runs #then an actionable error is returned", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const pi = new MemoryFakeExtensionAPI()
    registerMemfsCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "memfs", "tokens", ctx)

    // then
    expect(text).toContain("no memory repository")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})
