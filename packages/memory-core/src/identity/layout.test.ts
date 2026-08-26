import { describe, expect, it } from "bun:test"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  AGENTS_DIRNAME,
  buildIdentityPaths,
  defaultMemoryRoot,
  MEMORY_ROOT_ENV_VAR,
  REPO_DIRNAME,
  RUNTIME_DIRNAME,
  RUNTIME_SUBDIRNAMES,
  resolveMemoryRoot,
} from "./layout"

describe("memory identity layout constants", () => {
  it("#given the layout module #when constants are inspected #then they pin the decided directory names", () => {
    // given / when / then
    expect(MEMORY_ROOT_ENV_VAR).toBe("OMO_MEMORY_HOME")
    expect(AGENTS_DIRNAME).toBe("agents")
    expect(REPO_DIRNAME).toBe("repo")
    expect(RUNTIME_DIRNAME).toBe("runtime")
    expect([...RUNTIME_SUBDIRNAMES]).toEqual([
      "locks",
      "transcripts",
      "reflection",
      "reflection-sessions",
      "worktrees",
      "viewers",
      "push-queue",
      "facts-queue",
      "facts",
      "notices",
      "tool-receipts",
    ])
  })
})

describe("defaultMemoryRoot", () => {
  it("#given no override #when the default root is computed #then it is ~/.omo/memory", () => {
    // given / when
    const root = defaultMemoryRoot()
    // then
    expect(root).toBe(join(homedir(), ".omo", "memory"))
  })
})

describe("resolveMemoryRoot", () => {
  it("#given an absolute OMO_MEMORY_HOME #when the root is resolved #then the override is used verbatim", () => {
    // given (tmpdir() is absolute on every platform, so "verbatim" holds on Windows too)
    const overrideRoot = join(tmpdir(), "qa-memory-home")
    const env = { [MEMORY_ROOT_ENV_VAR]: overrideRoot }
    // when
    const root = resolveMemoryRoot(env, "/work/proj")
    // then
    expect(root).toBe(overrideRoot)
  })

  it("#given a relative OMO_MEMORY_HOME #when the root is resolved #then it resolves against the given cwd", () => {
    // given
    const env = { [MEMORY_ROOT_ENV_VAR]: "qa-home" }
    // when
    const root = resolveMemoryRoot(env, "/work/proj")
    // then (Windows qualifies the drive; resolve() is the platform semantics the impl applies)
    expect(root).toBe(resolve("/work/proj", "qa-home"))
  })

  it("#given an empty or whitespace OMO_MEMORY_HOME #when the root is resolved #then the default root is used", () => {
    // given
    const expected = join(homedir(), ".omo", "memory")
    // when / then
    expect(resolveMemoryRoot({ [MEMORY_ROOT_ENV_VAR]: "" }, "/work/proj")).toBe(expected)
    expect(resolveMemoryRoot({ [MEMORY_ROOT_ENV_VAR]: "   " }, "/work/proj")).toBe(expected)
    expect(resolveMemoryRoot({}, "/work/proj")).toBe(expected)
  })
})

describe("buildIdentityPaths", () => {
  it("#given a memory root and id #when paths are built #then the decided layout shape is produced", () => {
    // given
    const memoryRoot = "/mem"
    const id = "backend-lead-0123abcd"
    // when
    const paths = buildIdentityPaths(memoryRoot, id)
    // then
    const root = join(memoryRoot, "agents", id)
    const runtime = join(root, "runtime")
    expect(paths.root).toBe(root)
    expect(paths.repo).toBe(join(root, "repo"))
    expect(paths.runtime).toBe(runtime)
    expect(paths.locks).toBe(join(runtime, "locks"))
    expect(paths.transcripts).toBe(join(runtime, "transcripts"))
    expect(paths.reflection).toBe(join(runtime, "reflection"))
    expect(paths.reflectionSessions).toBe(join(runtime, "reflection-sessions"))
    expect(paths.worktrees).toBe(join(runtime, "worktrees"))
    expect(paths.viewers).toBe(join(runtime, "viewers"))
    expect(paths.pushQueue).toBe(join(runtime, "push-queue"))
    expect(paths.factsQueue).toBe(join(runtime, "facts-queue"))
    expect(paths.facts).toBe(join(runtime, "facts"))
    expect(paths.notices).toBe(join(runtime, "notices"))
    expect(paths.toolReceipts).toBe(join(runtime, "tool-receipts"))
  })

  it("#given built paths #when runtime subdirs are enumerated #then every declared subdir is present under runtime", () => {
    // given
    const paths = buildIdentityPaths("/mem", "abc-0123abcd")
    // when
    const allPaths = Object.values(paths)
    // then
    for (const subdir of RUNTIME_SUBDIRNAMES) {
      expect(allPaths).toContain(join(paths.runtime, subdir))
    }
  })
})
