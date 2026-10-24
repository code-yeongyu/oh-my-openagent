import { expect, test } from "bun:test"
import { EnvironmentGrantPolicy } from "./environment-grant-policy"
import type { GrantStore, EnvGrantSnapshot } from "./env-grant-store"
import type { SkillMcpClientInfo } from "./types"

function idAt(ids: readonly string[], index: number): string {
  const id = ids[index]
  if (id === undefined) throw new Error(`no grant id at index ${index}`)
  return id
}

function fixture() {
  const snapshot: EnvGrantSnapshot = { version: 1, generation: 0, grants: {} }
  const writes: string[] = []
  const store: GrantStore = {
    read: async () => snapshot,
    add: async (digest) => { writes.push(digest) },
    revoke: async () => {},
    list: async () => ({}),
    digest: async () => "0",
    watch: () => () => {},
  }
  const ids: string[] = []
  const policy = new EnvironmentGrantPolicy(store, (message) => {
    const id = message.match(/\/omo-mcp-env-grant ([a-f0-9]+)/)?.[1]
    if (!id) throw new Error("Notice omitted its grant handle")
    ids.push(id)
  })
  const info: SkillMcpClientInfo = {
    sessionID: "review", skillName: "fixture", serverName: "fixture", scope: "project",
    directory: "/synthetic/project", sourcePath: "/synthetic/project/SKILL.md",
  }
  const raw = { type: "http" as const, url: "https://example.invalid/${REVIEW_PRIVATE_TOKEN}" }
  return { policy, info, raw, ids, writes }
}

test("superseded notices invalidate earlier grant handles for the same identity", async () => {
  // given
  const f = fixture()
  try {
    await f.policy.prepare(f.info, f.raw)
    const first = idAt(f.ids, 0)
    // when: explicit environment changes the notice digest, not the declaration identity
    await f.policy.prepare(f.info, f.raw, { REVIEW_EXPLICIT: "changed" })
    expect(f.ids).toHaveLength(2)
    // then
    await expect(f.policy.grant(first)).rejects.toThrow("expired")
    expect(f.writes).toEqual([])
    await f.policy.grant(idAt(f.ids, 1))
    expect(f.writes).toHaveLength(1)
  } finally {
    f.policy.close()
  }
})

test("pending grant handles are capped and an evicted identity gets a fresh notice", async () => {
  // given
  const f = fixture()
  try {
    for (let i = 0; i < 129; i++) {
      await f.policy.prepare({ ...f.info, serverName: `server-${i}` }, f.raw)
    }
    const first = idAt(f.ids, 0)
    // when / then
    await expect(f.policy.grant(first)).rejects.toThrow("expired")
    expect(f.writes).toEqual([])
    await f.policy.prepare({ ...f.info, serverName: "server-0" }, f.raw)
    expect(f.ids).toHaveLength(130)
    expect(f.ids[129]).not.toBe(first)
    await f.policy.grant(idAt(f.ids, 129))
    expect(f.writes).toHaveLength(1)
  } finally {
    f.policy.close()
  }
})

test("a handle superseded during declaration revalidation cannot write a grant", async () => {
  // given
  const f = fixture()
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const resume = new Promise<void>((resolve) => { release = resolve })
  const sourcePath = f.info.sourcePath
  if (sourcePath === undefined) throw new Error("fixture has no sourcePath")
  const info = { ...f.info, revalidateDeclaration: async () => {
    entered()
    await resume
    return { config: f.raw, sourcePath, sourceKind: "frontmatter" as const }
  } }
  try {
    await f.policy.prepare(info, f.raw)
    // when
    const granting = f.policy.grant(idAt(f.ids, 0)).then(() => undefined, (error: unknown) => error)
    await started
    await f.policy.prepare(info, f.raw, { REVIEW_EXPLICIT: "changed" })
    release()
    // then
    expect(await granting).toBeInstanceOf(Error)
    expect(f.writes).toEqual([])
  } finally {
    release()
    f.policy.close()
  }
})
