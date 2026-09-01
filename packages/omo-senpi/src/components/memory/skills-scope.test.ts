/**
 * SPIKE NOTES (P26, verdict: ADDITIVE — resources_discover skillPaths merge into senpi
 * discovery without displacing project/user/builtin paths).
 *
 * Question: does a resources_discover handler returning skillPaths ADD to senpi's own
 * discovery (project/user/builtin), or displace it? Event reason is "startup" | "reload".
 *
 * Evidence (../senpi, READ-ONLY):
 * 1. Dispatch: packages/coding-agent/src/core/agent-session.ts:5119 + :5129-5155 — after
 *    session_start (and on reload, :5690) the session calls emitResourcesDiscover(cwd, reason)
 *    and feeds collected paths into resourceLoader.extendResources(...). Runner
 *    (core/extensions/runner.ts:1629-1665) invokes every extension's resources_discover
 *    handler, aggregates skillPaths/promptPaths/themePaths/hookPaths, and emits handler
 *    errors as diagnostics instead of throwing.
 * 2. ADDITIVE merge: core/resource-loader.ts:524-529 — extendResources sets
 *    lastSkillPaths = mergePaths(lastSkillPaths, extensionSkillPaths). lastSkillPaths was
 *    seeded from CLI + settings-enabled (project/user/builtin) discovery in the main load
 *    pass (:670-675). mergePaths (:1053-ish) concatenates primary-then-additional with
 *    canonical-path dedupe; existing entries are never dropped. => returned paths survive
 *    alongside prior discovery; nothing is displaced.
 * 3. Collision precedence: core/skills.ts loadSkills (:387+) iterates skillPaths in order,
 *    first-path-wins on skill name (later duplicates recorded as collision diagnostics).
 *    Extension paths are appended after the pre-existing set, so memory skills yield to
 *    project/user skills on name collision and otherwise load additively. Extension paths
 *    outside the user/project dirs classify as source "path".
 * 4. Missing dir handling: core/skills.ts emits a visible "skill path does not exist" warning.
 *    The memory extension therefore contributes repo/skills only after it exists.
 * 5. Real-harness proof of the event round-trip: test/suite/hooks-builtin-extension.test.ts
 *    ("collects resource-discovered hook paths as runtime hook sources") and
 *    test/suite/hooks-lifecycle.test.ts:152 register pi.on("resources_discover", ...) via a
 *    real ExtensionRunner + createTestExtensionsResult and assert collected paths from
 *    emitResourcesDiscover(cwd, "reload"). No existing senpi test pins skillPaths additivity
 *    specifically, and no omo consumer of resources_discover existed before this component
 *    (grep over packages/ returned none) — the additivity assertion therefore lives here at
 *    fake level (merge simulation mirroring mergePaths semantics) backed by evidence 2.
 *
 * letta 5-layer -> omo mapping: project -> senpi project scope; agent (memfs repo skills/)
 * -> THIS layer (resources_discover skillPaths); memory-fallback ($LETTA_MEMORY_DIR) -> NO
 * omo analog (recorded divergence); global -> senpi user scope; bundled -> senpi builtin.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { realpathSync } from "node:fs"
import { rmEfaultTolerant } from "./teardown.test-support"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import {
  MEMORY_SKILLS_DIRNAME,
  createMemorySkillsScopeHandler,
  memorySkillsDir,
  registerMemorySkillsScope,
  type MemorySkillsDiscoverResult,
} from "./skills-scope"

const IDENTITY = "skills-scope-agent"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rmEfaultTolerant(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function fixture(createSkills = true): Promise<{ context: MemoryIdentityContext; skillsDir: string }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-skills-scope-")))
  tempDirs.push(dir)
  const identityPaths = buildIdentityPaths(join(dir, "memory"), IDENTITY)
  const skillsDir = join(identityPaths.repo, MEMORY_SKILLS_DIRNAME)
  if (createSkills) await mkdir(skillsDir, { recursive: true })
  const context = createMemoryIdentityContext({
    identity: IDENTITY,
    identityPaths,
    binding: createMemoryBinding({ identity: IDENTITY, repoPath: identityPaths.repo, boundAt: 0 }),
  })
  return { context, skillsDir }
}

function discoverPayload(reason: "startup" | "reload", cwd: string): unknown {
  return { type: "resources_discover", cwd, reason }
}

function eventContext(sessionId: string): unknown {
  return { sessionManager: { getSessionId: () => sessionId } }
}

function expectDiscoverResult(value: unknown): MemorySkillsDiscoverResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected a resources_discover result object")
  }
  const skillPaths = Reflect.get(value, "skillPaths")
  if (!Array.isArray(skillPaths) || skillPaths.some((path) => typeof path !== "string")) {
    throw new Error("expected resources_discover result with string skillPaths")
  }
  return { skillPaths }
}

/**
 * Fake-level mirror of senpi DefaultResourceLoader.mergePaths: primary paths first, additional
 * appended, canonical duplicates dropped. Pins that extension-returned paths survive alongside
 * pre-existing discovery instead of displacing it (spike evidence 2).
 */
function mergeSkillPaths(primary: readonly string[], additional: readonly string[]): string[] {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const path of [...primary, ...additional]) {
    const resolved = resolve(path)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    merged.push(resolved)
  }
  return merged
}

describe("memorySkillsDir", () => {
  test("resolves to the identity repo skills dir", async () => {
    // #given
    const { context, skillsDir } = await fixture()

    // #when
    const dir = memorySkillsDir(context)

    // #then
    expect(dir).toBe(skillsDir)
    expect(dir).toBe(join(context.identityPaths.repo, "skills"))
  })
})

describe("createMemorySkillsScopeHandler", () => {
  test("returns the bound identity skills dir on startup", async () => {
    // #given
    const { context, skillsDir } = await fixture()
    const handler = createMemorySkillsScopeHandler({ resolveContext: () => context })

    // #when
    const result = handler(discoverPayload("startup", "/tmp/project"), eventContext("session-1"))

    // #then
    expect(result).toEqual({ skillPaths: [skillsDir] })
  })

  test("returns the bound identity skills dir on reload", async () => {
    // #given
    const { context, skillsDir } = await fixture()
    const handler = createMemorySkillsScopeHandler({ resolveContext: () => context })

    // #when
    const result = handler(discoverPayload("reload", "/tmp/project"), eventContext("session-1"))

    // #then
    expect(result).toEqual({ skillPaths: [skillsDir] })
  })

  test("resolves the context by event session id", async () => {
    // #given
    const { context, skillsDir } = await fixture()
    const seen: string[] = []
    const handler = createMemorySkillsScopeHandler({
      resolveContext: (sessionId) => {
        seen.push(sessionId)
        return sessionId === "session-bound" ? context : undefined
      },
    })

    // #when
    const bound = handler(discoverPayload("startup", "/tmp/project"), eventContext("session-bound"))
    const other = handler(discoverPayload("startup", "/tmp/project"), eventContext("session-other"))

    // #then
    expect(seen).toEqual(["session-bound", "session-other"])
    expect(bound).toEqual({ skillPaths: [skillsDir] })
    expect(other).toBeUndefined()
  })

  test("returns undefined for an unbound session so the chain passes through", async () => {
    // #given
    const handler = createMemorySkillsScopeHandler({ resolveContext: () => undefined })

    // #when
    const result = handler(discoverPayload("startup", "/tmp/project"), eventContext("session-1"))

    // #then
    expect(result).toBeUndefined()
  })

  test("returns undefined when the skills dir does not exist on disk", async () => {
    // #given
    const { context, skillsDir } = await fixture(false)
    const handler = createMemorySkillsScopeHandler({ resolveContext: () => context })

    // #when
    const result = handler(discoverPayload("startup", "/tmp/project"), eventContext("session-1"))

    // #then
    expect(result).toBeUndefined()
    const { existsSync } = await import("node:fs")
    expect(existsSync(skillsDir)).toBe(false)
  })

  test("ignores non-resources_discover payloads", async () => {
    // #given
    const { context } = await fixture()
    const handler = createMemorySkillsScopeHandler({ resolveContext: () => context })

    // #when
    const wrongType = handler({ type: "session_start" }, eventContext("session-1"))
    const notRecord = handler("resources_discover", eventContext("session-1"))

    // #then
    expect(wrongType).toBeUndefined()
    expect(notRecord).toBeUndefined()
  })

  test("returns undefined when the event context has no readable session id", async () => {
    // #given
    const { context } = await fixture()
    const handler = createMemorySkillsScopeHandler({ resolveContext: () => context })

    // #when
    const missingCtx = handler(discoverPayload("startup", "/tmp/project"), undefined)
    const noManager = handler(discoverPayload("startup", "/tmp/project"), {})
    const badId = handler(discoverPayload("startup", "/tmp/project"), {
      sessionManager: { getSessionId: () => 42 },
    })

    // #then
    expect(missingCtx).toBeUndefined()
    expect(noManager).toBeUndefined()
    expect(badId).toBeUndefined()
  })

  test("returned path survives into discovery additively without displacing existing paths", async () => {
    // #given
    const { context, skillsDir } = await fixture()
    const handler = createMemorySkillsScopeHandler({ resolveContext: () => context })
    const preExisting = ["/tmp/project/.pi/skills", "/home/user/.pi/agent/skills"]

    // #when
    const result = handler(discoverPayload("startup", "/tmp/project"), eventContext("session-1"))
    const merged = mergeSkillPaths(preExisting, result?.skillPaths ?? [])

    // #then
    expect(merged).toEqual([...preExisting.map((path) => resolve(path)), resolve(skillsDir)])
    expect(merged).toContain(resolve(preExisting[0]))
    expect(merged).toContain(resolve(preExisting[1]))
    expect(merged).toContain(resolve(skillsDir))
  })

  test("merge dedupes a skills dir already present in discovery", async () => {
    // #given
    const { context, skillsDir } = await fixture()
    const handler = createMemorySkillsScopeHandler({ resolveContext: () => context })

    // #when
    const result = handler(discoverPayload("reload", "/tmp/project"), eventContext("session-1"))
    const merged = mergeSkillPaths([skillsDir], result?.skillPaths ?? [])

    // #then
    expect(merged).toEqual([resolve(skillsDir)])
  })
})

describe("registerMemorySkillsScope", () => {
  test("registers a resources_discover handler that dispatches the bound skills dir", async () => {
    // #given
    const { context, skillsDir } = await fixture()
    const pi = new FakeExtensionAPI()
    registerMemorySkillsScope(pi, { resolveContext: () => context })

    // #when
    const results = await pi.dispatch(
      "resources_discover",
      discoverPayload("startup", "/tmp/project"),
      eventContext("session-1"),
    )

    // #then
    expect(pi.handlers.map((registration) => registration.event)).toEqual(["resources_discover"])
    expect(results.map(expectDiscoverResult)).toEqual([{ skillPaths: [skillsDir] }])
  })

  test("contributes nothing for an unbound session during dispatch", async () => {
    // #given
    const pi = new FakeExtensionAPI()
    registerMemorySkillsScope(pi, { resolveContext: () => undefined })

    // #when
    const results = await pi.dispatch(
      "resources_discover",
      discoverPayload("reload", "/tmp/project"),
      eventContext("session-1"),
    )

    // #then
    expect(results).toEqual([undefined])
  })
})
