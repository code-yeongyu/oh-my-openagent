// The direct memory surface reports every commit through onCommit(context, commit). A commit that
// touches a soul path (system/persona.md, system/identity.md) yields ONE soul-updated entry when
// soul.edit_notice is on and nothing otherwise; the direct surface never emits a write-updated entry
// because its own renderResult already draws that row. The receipt-file consumer that once fanned an
// MCP tool_result out to both notices was retired by the memory tool surface consolidation.
import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmEfaultTolerant } from "./teardown.test-support"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { createMemoryNoticeWiring, type MemoryNoticeWiringOptions } from "./memory-notice-wiring"
import { MemoryFakeExtensionAPI } from "./memory.test-support"
import { SOUL_UPDATED_ENTRY_TYPE } from "./soul-notice"

const IDENTITY = "memory-notice-agent"
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function fixture(): Promise<{ context: MemoryIdentityContext }> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-notice-")))
  roots.push(root)
  const identityPaths = buildIdentityPaths(root, IDENTITY)
  const context = createMemoryIdentityContext({
    identity: IDENTITY,
    identityPaths,
    binding: createMemoryBinding({ identity: IDENTITY, repoPath: identityPaths.repo, boundAt: 1 }),
  })
  return { context }
}

const SOUL_COMMIT = {
  sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  subject: "rewrite my persona",
  affectedPaths: ["system/persona.md"],
}
const FACT_COMMIT = {
  sha: "b2c3d4e5f60718293a4b5c6d7e8f901234567890",
  subject: "record the deploy runbook",
  affectedPaths: ["knowledge/deploy.md"],
}

function wiringFor(
  context: MemoryIdentityContext,
  overrides: Partial<MemoryNoticeWiringOptions> = {},
): ReturnType<typeof createMemoryNoticeWiring> {
  return createMemoryNoticeWiring({
    resolveContext: () => context,
    resolveEditNotice: () => true,
    ...overrides,
  })
}

describe("createMemoryNoticeWiring direct surface", () => {
  test("#given a soul commit #when onCommit fires #then exactly one soul notice is emitted with the commit facts", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = wiringFor(context)
    wiring.register(pi)

    // when
    wiring.onCommit(context, SOUL_COMMIT)

    // then
    expect(pi.entries).toEqual([{ customType: SOUL_UPDATED_ENTRY_TYPE, data: SOUL_COMMIT }])
  })

  test("#given a non-soul commit #when onCommit fires #then no entry is appended", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = wiringFor(context)
    wiring.register(pi)

    // when
    wiring.onCommit(context, FACT_COMMIT)

    // then
    expect(pi.entries).toHaveLength(0)
  })

  test("#given edit_notice disabled #when a soul commit arrives #then no visible entry is appended", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = wiringFor(context, { resolveEditNotice: () => false })
    wiring.register(pi)

    // when
    wiring.onCommit(context, SOUL_COMMIT)

    // then
    expect(pi.entries).toHaveLength(0)
  })

  test("#given the edit_notice resolver #when a soul commit arrives #then it is asked for THIS identity", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const asked: string[] = []
    const wiring = wiringFor(context, {
      resolveEditNotice: (identity) => {
        asked.push(identity)
        return true
      },
    })
    wiring.register(pi)

    // when
    wiring.onCommit(context, SOUL_COMMIT)

    // then
    expect(asked).toEqual([IDENTITY])
  })

  test("#given a wiring that never registered #when onCommit fires #then it is a no-op instead of throwing", async () => {
    // given
    const { context } = await fixture()
    const wiring = wiringFor(context)

    // when / then
    expect(() => wiring.onCommit(context, SOUL_COMMIT)).not.toThrow()
  })

  test("#given registration #when the component registers #then the soul entry renderer is registered", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()

    // when
    wiringFor(context).register(pi)

    // then
    expect(pi.entryRenderers.map((registration) => registration.customType)).toEqual([SOUL_UPDATED_ENTRY_TYPE])
  })
})
