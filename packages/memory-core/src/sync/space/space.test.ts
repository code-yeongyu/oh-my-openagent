import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createManifestDoc,
  joinDirection,
  joinSpaces,
  manifestAbsorbedInto,
  manifestAddBinding,
  manifestBindings,
  resolveSpace,
  resolveSpaceInRepo,
  SYNC_BINDING_CONFIG_KEY,
  SYNC_SPACE_CONFIG_KEY,
  type SpaceConfigStore,
} from "./index"
import { git } from "./test-support"

function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  const sets: [string, string][] = []
  const store: SpaceConfigStore = {
    get: (key: string) => map.get(key) ?? null,
    set: (key: string, value: string) => {
      map.set(key, value)
      sets.push([key, value])
    },
  }
  return { store, sets, map }
}

describe("resolveSpace (sync-design §3 binding keys)", () => {
  test("a named agent profile binds as named:", () => {
    const { store } = fakeStore()
    const r = resolveSpace(store, { profile: "  Dori\n" })
    expect(r.bindingKey).toBe("named:Dori")
    expect(r.spaceId).toBe("852b47fac13bd6a2f0d23f5b5d4fa103")
    expect(r.wrote.space).toBe(r.spaceId)
    expect(store.get(SYNC_SPACE_CONFIG_KEY)).toBe(r.spaceId)
  })

  test("an unset or auto profile falls through to the repository remote", () => {
    const remotes = [{ name: "origin", url: "git@github.com:a/b.git" }]
    for (const profile of [null, "", "auto"]) {
      const { store } = fakeStore()
      const r = resolveSpace(store, { profile, remotes })
      expect(r.bindingKey).toBe("repo:github.com/a/b")
      expect(r.spaceId).toBe("88c3c57d6699688f3cdd91b31b7e9f4d")
    }
  })

  test("a remote-less project mints a local: binding once and reuses it", () => {
    const { store, sets } = fakeStore()
    let mints = 0
    const randomHex = () => {
      mints++
      return "0".repeat(32)
    }
    const first = resolveSpace(store, { randomHex })
    expect(first.bindingKey).toBe(`local:${"0".repeat(32)}`)
    expect(first.wrote.binding).toBe(first.bindingKey)
    const second = resolveSpace(store, { randomHex })
    expect(second.bindingKey).toBe(first.bindingKey)
    expect(second.wrote).toEqual({})
    expect(second.spaceId).toBe(first.spaceId)
    expect(mints).toBe(1)
    expect(sets.filter(([k]) => k === SYNC_BINDING_CONFIG_KEY)).toHaveLength(1)
  })

  test("a corrupt stored local binding is re-minted", () => {
    const { store } = fakeStore({ [SYNC_BINDING_CONFIG_KEY]: "garbage" })
    const r = resolveSpace(store, { randomHex: () => "f".repeat(32) })
    expect(r.bindingKey).toBe(`local:${"f".repeat(32)}`)
    expect(store.get(SYNC_BINDING_CONFIG_KEY)).toBe(r.bindingKey)
  })

  test("omo.sync.space is sticky when the remote URL changes", () => {
    const { store } = fakeStore()
    const first = resolveSpace(store, { remotes: [{ name: "origin", url: "git@github.com:a/b.git" }] })
    const second = resolveSpace(store, { remotes: [{ name: "origin", url: "https://github.com/a/renamed.git" }] })
    expect(second.spaceId).toBe(first.spaceId)
    expect(second.bindingKey).toBe("repo:github.com/a/renamed")
    expect(second.aliasOfStoredSpace).toBe(true)
    expect(first.aliasOfStoredSpace).toBe(false)
  })
})

describe("joinDirection", () => {
  test("joins toward the lower space id, either argument order", () => {
    expect(joinDirection("aaaa", "bbbb")).toEqual({ target: "aaaa", absorbed: "bbbb" })
    expect(joinDirection("bbbb", "aaaa")).toEqual({ target: "aaaa", absorbed: "bbbb" })
  })

  test("a space does not join itself", () => {
    expect(joinDirection("aaaa", "aaaa")).toBeNull()
  })
})

describe("joinSpaces (insert-only join, absorbed_into tombstone)", () => {
  test("the lower id absorbs: keys union, the absorbed manifest is tombstoned", async () => {
    const a = await createManifestDoc("1")
    manifestAddBinding(a, "repo:github.com/a/b")
    const b = await createManifestDoc("2")
    manifestAddBinding(b, "repo:github.com/a/renamed")
    const r = joinSpaces(a, "aaaa", b, "bbbb")
    expect(r).toEqual({ targetId: "aaaa", absorbedId: "bbbb", changed: true })
    expect(manifestBindings(a)).toEqual(["repo:github.com/a/b", "repo:github.com/a/renamed"])
    expect(manifestAbsorbedInto(b)).toBe("aaaa")
    expect(manifestAbsorbedInto(a)).toBeNull()
    a.free()
    b.free()
  })

  test("the argument order never changes the direction", async () => {
    const a = await createManifestDoc("1")
    const b = await createManifestDoc("2")
    manifestAddBinding(a, "named:x")
    manifestAddBinding(b, "named:y")
    const r = joinSpaces(b, "bbbb", a, "aaaa")
    expect(r.targetId).toBe("aaaa")
    expect(r.absorbedId).toBe("bbbb")
    expect(manifestAbsorbedInto(b)).toBe("aaaa")
    a.free()
    b.free()
  })

  test("joins are idempotent: a second join of the same pair changes nothing", async () => {
    const a = await createManifestDoc("1")
    const b = await createManifestDoc("2")
    manifestAddBinding(a, "named:x")
    manifestAddBinding(b, "named:y")
    joinSpaces(a, "aaaa", b, "bbbb")
    const keysBefore = manifestBindings(a)
    const again = joinSpaces(a, "aaaa", b, "bbbb")
    expect(again.changed).toBe(false)
    expect(manifestBindings(a)).toEqual(keysBefore)
    expect(manifestAbsorbedInto(b)).toBe("aaaa")
    a.free()
    b.free()
  })

  test("a manifest already absorbed elsewhere is never re-joined", async () => {
    const a = await createManifestDoc("1")
    const b = await createManifestDoc("2")
    manifestAddBinding(b, "named:y")
    joinSpaces(a, "aaaa", b, "bbbb")
    const c = await createManifestDoc("3")
    const r = joinSpaces(c, "0000", b, "bbbb")
    expect(r.changed).toBe(false)
    expect(manifestAbsorbedInto(b)).toBe("aaaa")
    expect(manifestBindings(c)).toEqual([])
    a.free()
    b.free()
    c.free()
  })

  test("joining a space with itself is a no-op", async () => {
    const a = await createManifestDoc("1")
    manifestAddBinding(a, "named:x")
    const r = joinSpaces(a, "aaaa", a, "aaaa")
    expect(r.changed).toBe(false)
    expect(manifestAbsorbedInto(a)).toBeNull()
    a.free()
  })
})

describe("resolveSpaceInRepo / git-backed config", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  function tmpRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "omo-space-test-"))
    dirs.push(dir)
    git(dir, ["init", "-q"])
    return dir
  }

  test("binds to the origin remote and persists omo.sync.space in local config", () => {
    const dir = tmpRepo()
    git(dir, ["remote", "add", "origin", "git@github.com:a/b.git"])
    const first = resolveSpaceInRepo(dir, {})
    expect(first.bindingKey).toBe("repo:github.com/a/b")
    expect(git(dir, ["config", "--local", "--get", "omo.sync.space"]).trim()).toBe(first.spaceId)
    git(dir, ["remote", "set-url", "origin", "ssh://git@github.com/a/renamed.git"])
    const second = resolveSpaceInRepo(dir, {})
    expect(second.spaceId).toBe(first.spaceId)
    expect(second.bindingKey).toBe("repo:github.com/a/renamed")
    expect(second.aliasOfStoredSpace).toBe(true)
  })

  test("a remote-less repo mints and persists a local: binding", () => {
    const dir = tmpRepo()
    const first = resolveSpaceInRepo(dir, {})
    expect(first.bindingKey).toMatch(/^local:[0-9a-f]{32}$/)
    expect(git(dir, ["config", "--local", "--get", "omo.sync.binding"]).trim()).toBe(first.bindingKey)
    expect(resolveSpaceInRepo(dir, {}).bindingKey).toBe(first.bindingKey)
  })

  test("a malformed remote falls back to a persistent local binding", () => {
    const dir = tmpRepo()
    git(dir, ["remote", "add", "origin", "https://[bad"])
    const first = resolveSpaceInRepo(dir, { randomHex: () => "a".repeat(32) })
    expect(first.bindingKey).toBe(`local:${"a".repeat(32)}`)
    const second = resolveSpaceInRepo(dir, {})
    expect(second.bindingKey).toBe(first.bindingKey)
    expect(second.wrote).toEqual({})
  })
})
