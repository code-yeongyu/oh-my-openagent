import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"

import { CONFIG_KEY } from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import {
  fakeCommandContext,
  fakeDeps,
  invoke,
  seededRepo,
  tempIdentity,
} from "./commands.test-support"
import { registerMemoryRepositoryCommand } from "./memory-repository"

const tempDirs: string[] = []

// Port 1 on loopback refuses immediately, so mirror pushes fail fast and offline.
const CREDENTIALED_URL = "https://user:s3cr3t-token@127.0.0.1:1/memory.git"

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const SEEDS = [
  { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nseeded persona\n" },
]

async function harness(options: { readonly seeded?: boolean } = {}) {
  const { root, identity } = await tempIdentity()
  tempDirs.push(root)
  const repo = options.seeded === false ? undefined : await seededRepo(identity, SEEDS)
  const pi = new MemoryFakeExtensionAPI()
  registerMemoryRepositoryCommand(pi, fakeDeps(identity))
  return { identity, repo, pi, ctx: fakeCommandContext() }
}

describe("/memory-repository", () => {
  test("#given a credentialed url #when set runs #then config is written and output is redacted", async () => {
    // given
    const { repo, pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memory-repository", `set ${CREDENTIALED_URL}`, ctx)

    // then
    expect(await repo?.configGet(CONFIG_KEY)).toBe(CREDENTIALED_URL)
    expect(text).toContain("127.0.0.1")
    expect(text).not.toContain("s3cr3t-token")
    expect(ctx.ui.notifications.every((entry) => !entry.message.includes("s3cr3t-token"))).toBe(true)
  }, 20_000)

  test("#given a configured mirror #when status runs #then the redacted url and ahead count render", async () => {
    // given
    const { repo, pi, ctx } = await harness()
    await repo?.configSet(CONFIG_KEY, CREDENTIALED_URL)

    // when
    const text = await invoke(pi, "memory-repository", "status", ctx)

    // then
    expect(text).toContain("127.0.0.1")
    expect(text).not.toContain("s3cr3t-token")
    expect(text).toContain("ahead")
  }, 20_000)

  test("#given no configured mirror #when status runs #then it reports the unconfigured state", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memory-repository", "status", ctx)

    // then
    expect(text).toContain("no memory repository configured")
  })

  test("#given a configured mirror #when unset runs #then the config key is removed", async () => {
    // given
    const { repo, pi, ctx } = await harness()
    await repo?.configSet(CONFIG_KEY, CREDENTIALED_URL)

    // when
    const text = await invoke(pi, "memory-repository", "unset", ctx)

    // then
    expect(await repo?.configGet(CONFIG_KEY)).toBeNull()
    expect(text).toContain("unset")
  })

  test("#given no configured mirror #when push runs #then an actionable error is returned", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memory-repository", "push", ctx)

    // then
    expect(text).toContain("no memory repository configured")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given an unreachable mirror #when push runs #then the failure is reported with a redacted detail", async () => {
    // given
    const { repo, pi, ctx } = await harness()
    await repo?.configSet(CONFIG_KEY, CREDENTIALED_URL)

    // when
    const text = await invoke(pi, "memory-repository", "push", ctx)

    // then
    expect(text).toContain("push failed")
    expect(text).not.toContain("s3cr3t-token")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  }, 20_000)

  test("#given set without a url #when invoked #then a usage error is returned", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memory-repository", "set", ctx)

    // then
    expect(text).toContain("usage: /memory-repository set <url>")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given an unknown subcommand #when invoked #then an actionable error is returned", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "memory-repository", "frobnicate", ctx)

    // then
    expect(text).toContain("unknown /memory-repository subcommand")
  })

  test("#given an unbound session #when invoked #then an actionable error is returned", async () => {
    // given
    const pi = new MemoryFakeExtensionAPI()
    registerMemoryRepositoryCommand(pi, fakeDeps(undefined))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "memory-repository", "status", ctx)

    // then
    expect(text).toContain("not bound")
  })
})
