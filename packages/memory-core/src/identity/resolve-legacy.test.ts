import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"
import { AGENTS_DIRNAME, MEMORY_ROOT_ENV_VAR } from "./layout"
import { FALLBACK_SLUG, type DirectoryProbe, resolveMemoryIdentity } from "./resolve"

function expectedHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 8)
}

const MEMORY_ROOT = resolve("/mem")
const env = { [MEMORY_ROOT_ENV_VAR]: MEMORY_ROOT }

function probeWithExisting(existing: readonly string[]): DirectoryProbe & { readonly calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    exists(path: string): boolean {
      calls.push(path)
      return existing.includes(path)
    },
  }
}

function agentDir(id: string): string {
  return join(MEMORY_ROOT, AGENTS_DIRNAME, id)
}

describe("resolveMemoryIdentity legacy-slug compatibility", () => {
  it("#given a Korean explicit id whose legacy fallback directory exists #when resolved #then the legacy id keeps the existing repo", () => {
    // given
    const legacyId = `${FALLBACK_SLUG}-${expectedHash("홍길동")}`
    const probe = probeWithExisting([agentDir(legacyId)])
    // when
    const identity = resolveMemoryIdentity("홍길동", "/repo/alpha", env, probe)
    // then
    expect(identity.id).toBe(legacyId)
    expect(identity.safeSlug).toBe(FALLBACK_SLUG)
    expect(identity.paths.root).toBe(agentDir(legacyId))
  })

  it("#given a Korean explicit id with no legacy directory #when resolved #then the readable Korean id is used", () => {
    // given
    const probe = probeWithExisting([])
    // when
    const identity = resolveMemoryIdentity("홍길동", "/repo/alpha", env, probe)
    // then
    const expectedId = `홍길동-${expectedHash("홍길동")}`
    expect(identity.id).toBe(expectedId)
    expect(identity.safeSlug).toBe("홍길동")
    expect(identity.paths.root).toBe(agentDir(expectedId))
  })

  it("#given both the legacy and the readable directory exist #when resolved #then the readable id wins", () => {
    // given
    const readableId = `홍길동-${expectedHash("홍길동")}`
    const legacyId = `${FALLBACK_SLUG}-${expectedHash("홍길동")}`
    const probe = probeWithExisting([agentDir(legacyId), agentDir(readableId)])
    // when
    const identity = resolveMemoryIdentity("홍길동", "/repo/alpha", env, probe)
    // then
    expect(identity.id).toBe(readableId)
  })

  it("#given an ASCII explicit id #when resolved #then the filesystem is never probed", () => {
    // given
    const probe = probeWithExisting([])
    // when
    const identity = resolveMemoryIdentity("backend-lead", "/repo/alpha", env, probe)
    // then
    expect(identity.id).toBe(`backend-lead-${expectedHash("backend-lead")}`)
    expect(probe.calls).toEqual([])
  })

  it("#given a Korean project basename in auto mode with a legacy directory #when resolved #then the legacy auto id is kept", () => {
    // given
    const cwd = "/repo/프로젝트"
    const legacyId = `${FALLBACK_SLUG}-${expectedHash(resolve(cwd))}`
    const probe = probeWithExisting([agentDir(legacyId)])
    // when
    const identity = resolveMemoryIdentity("auto", cwd, env, probe)
    // then
    expect(identity.id).toBe(legacyId)
  })

  it("#given a Korean project basename in auto mode without a legacy directory #when resolved #then the slug is the Korean basename", () => {
    // given
    const cwd = "/repo/프로젝트"
    const probe = probeWithExisting([])
    // when
    const identity = resolveMemoryIdentity("auto", cwd, env, probe)
    // then
    expect(identity.safeSlug).toBe("프로젝트")
    expect(identity.id).toBe(`프로젝트-${expectedHash(resolve(cwd))}`)
  })
})
