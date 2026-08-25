import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"

import { FactsFailureStore, memoryWriterLockPath } from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI, memorySettings } from "../memory.test-support"
import {
  fakeCommandContext,
  fakeDeps,
  invoke,
  seedReflectionFailureStreak,
  seededRepo,
  tempIdentity,
  type FakeDeps,
} from "./commands.test-support"
import { registerDoctorCommand } from "./doctor"

const tempDirs: string[] = []

setDefaultTimeout(process.platform === "win32" ? 30000 : 5000)

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

const SEEDS = [
  { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nseeded persona\n" },
]

async function harness(options: { readonly seeded?: boolean; readonly deps?: Partial<FakeDeps> } = {}) {
  const { root, identity } = await tempIdentity()
  tempDirs.push(root)
  if (options.seeded !== false) await seededRepo(identity, SEEDS)
  const deps = fakeDeps(identity, options.deps)
  const pi = new MemoryFakeExtensionAPI()
  registerDoctorCommand(pi, deps)
  return { root, identity, deps, pi, ctx: fakeCommandContext() }
}

async function writeLock(locksDir: string, pid: number): Promise<string> {
  await mkdir(locksDir, { recursive: true })
  const path = memoryWriterLockPath(locksDir)
  await writeFile(
    path,
    `${JSON.stringify({
      pid,
      process_start: "start-token",
      hostname: hostname(),
      nonce: "nonce-1",
      created_at: new Date().toISOString(),
      purpose: "memory-write",
    })}\n`,
  )
  return path
}

// Byte-exact v1 persona seed (commit 02a7d562e): historical fixture data used to prove the
// v1 detection advisory fires on content identity, not on wording. Em dashes are part of the
// frozen bytes and must never be normalized; they are written as \u2014 escapes so the
// source stays dash-free while the rendered bytes stay identical.
const V1_PERSONA_BODY = `You are a coding agent that maintains its own memory.

Your persistent context lives in a version-controlled memory filesystem rooted at $MEMORY_DIR. Files committed to HEAD are projected into your system prompt on the next run:

- system/persona.md (this file) \u2014 who you are and how you operate. Edit it to refine your own working identity.
- system/human.md \u2014 what you have learned about the person you work with. Update it as you discover durable preferences, context, and constraints.
- system/*.md \u2014 any other memory blocks you create under system/ are projected as nested XML.
- Non-system paths (for example reference/ or notes/) appear as names in <external_projection> only; their bodies are never injected.

Changes to these files only take effect after a git commit. Use the memory tools to edit, never hand-write raw git commands during a session. The system/ directory is your self-model; keep it accurate and minimal.`

const V1_PERSONA_SEED = `---\ndescription: Persona - who I am\n---\n${V1_PERSONA_BODY}`

describe("/doctor", () => {
  test("#given a healthy repository #when doctor runs #then every deterministic check passes", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[ok] repository")
    expect(text).toContain("[ok] frontmatter")
    expect(text).toContain("[ok] locks")
    expect(text).toContain("[ok] worktrees")
    expect(text).toContain("[ok] tokens")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })

  test("#given a persona still equal to the v1 seed #when doctor runs #then a soul-seed advisory is reported", async () => {
    // given
    const { identity, pi, ctx } = await harness({ seeded: false })
    await seededRepo(identity, [{ relativePath: "system/persona.md", content: V1_PERSONA_SEED }])

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[warn] soul-seed")
  })

  test("#given a persona that diverged from the v1 seed #when doctor runs #then no soul-seed advisory fires", async () => {
    // given (the default harness seeds a non-v1 persona)
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[ok] soul-seed")
  })

  test("#given no repository #when doctor runs #then the repository check fails with an actionable hint", async () => {
    // given
    const { pi, ctx } = await harness({ seeded: false })

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[fail] repository")
    expect(text).toContain("/memfs init")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given a memory file with invalid frontmatter #when doctor runs #then the sweep fails and names the file", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    await writeFile(join(identity.identityPaths.repo, "system", "broken.md"), "no frontmatter here\n")

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[fail] frontmatter")
    expect(text).toContain("system/broken.md")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given a missing persona file #when doctor runs #then a persona warning is reported", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    await seededRepo(identity, [{ relativePath: "external/notes.md", content: "notes\n" }])
    const pi = new MemoryFakeExtensionAPI()
    registerDoctorCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[warn] persona")
    expect(text).toContain("system/persona.md")
  })

  test("#given a lock owned by a dead pid #when doctor runs #then the stale lock is reported with its path", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    const lockPath = await writeLock(identity.identityPaths.locks, 987_654)

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[warn] locks")
    expect(text).toContain(lockPath)
    expect(text).toContain("987654")
  })

  test("#given a lock owned by a live pid #when doctor runs #then no stale lock is reported", async () => {
    // given
    const { identity, deps, pi, ctx } = await harness()
    await writeLock(identity.identityPaths.locks, 4242)
    deps.alivePids.add(4242)

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[ok] locks")
  })

  test("#given repeated model-not-found reflection failures #when doctor runs #then reflection health and remediation are reported", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    const completions = join(identity.identityPaths.reflection, "completions")
    await mkdir(completions, { recursive: true })
    const failureBaseMs = Date.now() - 3 * 60 * 60_000
    for (let index = 0; index < 3; index += 1) {
      const startedAtMs = failureBaseMs + index * 60_000
      await writeFile(join(completions, `run-${index}.json`), `${JSON.stringify({
        schemaVersion: 1,
        runId: `run-${index}`,
        identity: identity.identity,
        category: "quick",
        conversationIds: ["past-session"],
        trigger: "manual",
        outcome: "failed",
        reason: "model-not-found",
        detail: "configured model unavailable",
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: new Date(startedAtMs + 60_000).toISOString(),
        delivery: { status: index === 2 ? "pending" : "consumed" },
      })}\n`)
    }

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[warn] reflection-health")
    expect(text).toContain("streak 3")
    expect(text).toContain("pending 1")
    expect(text).toContain("adjust memory.reflection category/model in your omo config")
  })

  // Fixed-epoch boundary pair pinning BOTH sides of REFLECTION_HEALTH_STALE_MS (7 days), past which
  // a trailing failure burst retires and [warn] decays to [ok] on the passage of time alone. Each
  // case carries its OWN epoch, chosen so an implementation reading Date.now() instead of the
  // injected value lands on the WRONG side of the gate: the warn case is anchored in the past (a
  // wall clock reads its fresh streak as stale), the ok case in the future (a wall clock reads its
  // stale streak as fresh). One shared epoch cannot do that - whichever side the wall clock fell
  // on, one case would pass by calendar coincidence, which is how dev run 32209640837 went green.
  const WARN_NOW_MS = Date.parse("2026-08-12T05:00:00.000Z")
  const OK_NOW_MS = Date.parse("2126-08-12T05:00:00.000Z")

  test("#given a failure streak one hour before the injected now #when doctor runs #then reflection health warns with the live streak", async () => {
    // given
    const { identity, pi, ctx } = await harness({ deps: { now: () => WARN_NOW_MS } })
    await seedReflectionFailureStreak(identity.identityPaths.reflection, WARN_NOW_MS - 60 * 60_000)

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[warn] reflection-health")
    expect(text).toContain("streak 3")
  })

  test("#given the same streak shifted past the seven-day stale window #when doctor runs #then reflection health reads ok with a retired streak", async () => {
    // given (identical records, only the offset from the injected now differs)
    const { identity, pi, ctx } = await harness({ deps: { now: () => OK_NOW_MS } })
    const eightDaysBefore = OK_NOW_MS - 8 * 24 * 60 * 60_000
    await seedReflectionFailureStreak(identity.identityPaths.reflection, eightDaysBefore)

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[ok] reflection-health")
    expect(text).toContain("streak 0")
  })

  test("#given an abandoned reservation run #when doctor runs #then manual-disposal paths are reported", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    const runDir = join(identity.identityPaths.reflection, "runs", "run-abandoned")
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, "abandoned.json"), `${JSON.stringify({
      version: 1,
      runId: "run-abandoned",
      outcome: "abandoned_unknown",
      abandonedAt: "2026-08-10T00:00:00.000Z",
    })}\n`)

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[warn] abandoned-runs")
    expect(text).toContain(runDir)
    expect(ctx.ui.notifications.at(-1)?.level).toBe("warning")
  })

  test("#given an unregistered worktree directory #when doctor runs #then the orphan is reported", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    await mkdir(join(identity.identityPaths.worktrees, "orphan-run"), { recursive: true })

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[warn] worktrees")
    expect(text).toContain("orphan-run")
  })

  test("#given a system estimate over the warn threshold #when doctor runs #then a token advisory is reported", async () => {
    // given
    const { pi, ctx } = await harness({
      deps: { loadSettings: () => ({ settings: memorySettings({ compile_warn_tokens: 1 }), configPath: "/tmp/omo.jsonc" }) },
    })

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[warn] tokens")
    expect(text).toContain("1")
  })

  test("#given a skill missing name frontmatter #when doctor runs #then the repair helper reports the fix", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    await mkdir(join(identity.identityPaths.repo, "skills", "commit"), { recursive: true })
    await writeFile(join(identity.identityPaths.repo, "skills", "commit", "SKILL.md"), "---\ndescription: x\n---\n")

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("skills/commit/SKILL.md")
    expect(text).toContain("name:")
  })

  test("#given parked facts batches #when doctor runs #then one bounded advisory line names /facts retry", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    const store = new FactsFailureStore({ identityPaths: identity.identityPaths })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await store.recordFailure({
        targets: [{ conversationId: "conv-a", endMessageId: "msg-a", endSnapshotLine: 2 }],
        failureId: `run-${attempt}`,
        reason: "child_exit",
      })
    }

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    const factsLines = text.split("\n").filter((line) => line.includes("] facts:"))
    expect(factsLines).toHaveLength(1)
    expect(factsLines[0]).toContain("1 parked")
    expect(factsLines[0]).toContain("/facts retry")
  })

  test("#given no facts failures #when doctor runs #then no facts advisory line is rendered", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text.split("\n").filter((line) => line.includes("] facts:"))).toEqual([])
  })

  test("#given an unbound session #when doctor runs #then an actionable error is returned", async () => {
    // given
    const pi = new MemoryFakeExtensionAPI()
    registerDoctorCommand(pi, fakeDeps(undefined))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("not bound")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})
