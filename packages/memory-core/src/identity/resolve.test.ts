import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { AGENTS_DIRNAME, MEMORY_ROOT_ENV_VAR } from "./layout"
import { resolveMemoryIdentity } from "./resolve"

function expectedHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 8)
}

describe("resolveMemoryIdentity auto mode", () => {
  it("#given the same cwd #when resolved repeatedly #then the id is deterministic", () => {
    // given
    const cwd = "/repo/alpha"
    // when
    const first = resolveMemoryIdentity("auto", cwd, {})
    const second = resolveMemoryIdentity("auto", cwd, {})
    const fromUndefined = resolveMemoryIdentity(undefined, cwd, {})
    const fromEmpty = resolveMemoryIdentity("", cwd, {})
    const fromBlank = resolveMemoryIdentity("   ", cwd, {})
    // then
    expect(second.id).toBe(first.id)
    expect(second.paths).toEqual(first.paths)
    expect(fromUndefined.id).toBe(first.id)
    expect(fromEmpty.id).toBe(first.id)
    expect(fromBlank.id).toBe(first.id)
  })

  it("#given two projects with the same basename #when resolved #then slugs match but ids differ", () => {
    // given / when
    const one = resolveMemoryIdentity("auto", "/repo/alpha", {})
    const two = resolveMemoryIdentity("auto", "/other/alpha", {})
    // then
    expect(one.safeSlug).toBe("alpha")
    expect(two.safeSlug).toBe("alpha")
    expect(one.id).not.toBe(two.id)
  })

  it("#given cwd spelling variants #when resolved #then normalization yields the same id", () => {
    // given / when
    const clean = resolveMemoryIdentity("auto", "/repo/alpha", {})
    const trailing = resolveMemoryIdentity("auto", "/repo/alpha/", {})
    const dotted = resolveMemoryIdentity("auto", "/repo/./alpha", {})
    // then
    expect(trailing.id).toBe(clean.id)
    expect(dotted.id).toBe(clean.id)
  })

  it("#given a project path #when resolved #then the id is basename slug plus sha256-8 of the full path", () => {
    // given
    const cwd = "/x/My Proj"
    // when
    const identity = resolveMemoryIdentity("auto", cwd, {})
    // then
    expect(identity.safeSlug).toBe("my-proj")
    expect(identity.id).toBe(`my-proj-${expectedHash(resolve(cwd))}`)
  })

  it("#given no root override #when resolved #then paths live under ~/.omo/memory/agents/<id>", () => {
    // given / when
    const identity = resolveMemoryIdentity("auto", "/repo/alpha", {})
    // then
    const expectedRoot = join(homedir(), ".omo", "memory", AGENTS_DIRNAME, identity.id)
    expect(identity.paths.root).toBe(expectedRoot)
    expect(identity.paths.repo).toBe(join(expectedRoot, "repo"))
  })
})

describe("resolveMemoryIdentity explicit mode", () => {
  it("#given explicit id 'backend-lead' #when resolved #then the dir is agents/backend-lead-<hash>", () => {
    // given / when
    const identity = resolveMemoryIdentity("backend-lead", "/repo/alpha", {})
    // then
    const expectedId = `backend-lead-${expectedHash("backend-lead")}`
    expect(identity.safeSlug).toBe("backend-lead")
    expect(identity.id).toBe(expectedId)
    expect(identity.paths.root).toBe(
      join(homedir(), ".omo", "memory", AGENTS_DIRNAME, expectedId),
    )
  })

  it("#given an explicit id with surrounding whitespace #when resolved #then it matches the trimmed form", () => {
    // given / when
    const padded = resolveMemoryIdentity("  backend-lead  ", "/repo/alpha", {})
    const plain = resolveMemoryIdentity("backend-lead", "/repo/alpha", {})
    // then
    expect(padded.id).toBe(plain.id)
  })

  it("#given the exact keyword 'auto' #when compared with 'Auto' #then only lowercase triggers auto mode", () => {
    // given / when
    const keyword = resolveMemoryIdentity("auto", "/repo/alpha", {})
    const named = resolveMemoryIdentity("Auto", "/repo/alpha", {})
    // then
    expect(keyword.id).toBe(`alpha-${expectedHash(resolve("/repo/alpha"))}`)
    expect(named.safeSlug).toBe("auto")
    expect(named.id).toBe(`auto-${expectedHash("Auto")}`)
    expect(named.id).not.toBe(keyword.id)
  })
})

describe("resolveMemoryIdentity root override", () => {
  it("#given OMO_MEMORY_HOME #when resolved #then paths honor it and sanitization still applies", () => {
    // given (tmpdir() is absolute on every platform, so "verbatim" holds on Windows too)
    const overrideRoot = join(tmpdir(), "qa-memory-home")
    const env = { [MEMORY_ROOT_ENV_VAR]: overrideRoot }
    // when
    const identity = resolveMemoryIdentity("../evil", "/repo/alpha", env)
    // then
    expect(identity.paths.root).toBe(
      join(overrideRoot, AGENTS_DIRNAME, `evil-${expectedHash("../evil")}`),
    )
    expect(identity.paths.repo).toBe(join(identity.paths.root, "repo"))
    expect(identity.paths.pushQueue).toBe(join(identity.paths.root, "runtime", "push-queue"))
  })

  it("#given a relative OMO_MEMORY_HOME #when resolved #then it resolves against the cwd argument", () => {
    // given
    const env = { [MEMORY_ROOT_ENV_VAR]: "qa-home" }
    // when
    const identity = resolveMemoryIdentity("auto", "/work/proj", env)
    // then (Windows qualifies the drive; resolve() is the platform semantics the impl applies)
    expect(identity.paths.root).toBe(
      join(resolve("/work/proj", "qa-home"), AGENTS_DIRNAME, identity.id),
    )
  })

  it("#given no env argument #when OMO_MEMORY_HOME is set in the process env #then the default env read honors it", () => {
    // given
    const previous = process.env[MEMORY_ROOT_ENV_VAR]
    process.env[MEMORY_ROOT_ENV_VAR] = join(tmpdir(), "qa-process-env-home")
    try {
      // when
      const identity = resolveMemoryIdentity("backend-lead", "/repo/alpha")
      // then
      expect(identity.paths.root).toBe(
        join(resolve("/repo/alpha", join(tmpdir(), "qa-process-env-home")), AGENTS_DIRNAME, identity.id),
      )
    } finally {
      if (previous === undefined) {
        delete process.env[MEMORY_ROOT_ENV_VAR]
      } else {
        process.env[MEMORY_ROOT_ENV_VAR] = previous
      }
    }
  })
})

describe("resolveMemoryIdentity input guards", () => {
  it("#given an empty cwd #when resolved #then it throws a TypeError", () => {
    // given / when / then
    expect(() => resolveMemoryIdentity("auto", "", {})).toThrow(TypeError)
    expect(() => resolveMemoryIdentity("auto", "   ", {})).toThrow(TypeError)
  })
})
