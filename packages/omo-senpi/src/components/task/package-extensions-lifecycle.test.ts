import { describe, expect, spyOn, test } from "bun:test"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { RpcProcessRunner } from "@oh-my-opencode/senpi-task"

import { buildRespawnRunner, createInheritedExtensionsResolver } from "./engine-runners"
import { TaskRuntimeContext } from "./runtime-context"

const SPEC = {
  task_id: "st_revived",
  cwd: "/project",
  state_dir: "/state",
  prompt: "resume",
} as const

function buildContext(roots: readonly string[], loaded: readonly string[]) {
  const runtime = new TaskRuntimeContext("/project")
  runtime.captureFrom({ loadedExtensionPaths: [...loaded] })
  return {
    runtime,
    sharedParentTools: () => [],
    settings: OmoTaskSettingsSchema.parse({ process_runner: "child-process" }),
    platform: "darwin" as const,
    agentDir: "/agent",
    listInstalledPackageRoots: () => roots,
  }
}

describe("package extensions across the child lifecycle", () => {
  test("#given a revived child that names no extensions #when the respawn runner starts it #then it inherits the same package paths an initial spawn gets", async () => {
    // given: revival is the path that used to fall back to a bare RpcProcessRunner, which carries no
    // inherited extensions at all - so a child enabled by #8492 lost its provider on every revival.
    const originalArgv = process.argv
    process.argv = ["bun", "omo", "-e", "/installed/omo/plugin"]
    const stopped = new Error("stop before spawning")
    const inherited: (readonly string[] | undefined)[] = []
    const start = spyOn(RpcProcessRunner.prototype, "start").mockImplementation(function (this: RpcProcessRunner, spec) {
      inherited.push(spec.extensions ?? this["inheritedExtensions"])
      return Promise.reject(stopped)
    })
    try {
      const runner = buildRespawnRunner(
        buildContext(["/installed/provider"], ["/installed/provider/extensions/zcode.ts"]),
      )

      // when
      await expect(runner.start({ ...SPEC })).rejects.toBe(stopped)

      // then
      expect(inherited).toEqual([["/installed/omo/plugin", "/installed/provider/extensions/zcode.ts"]])
    } finally {
      start.mockRestore()
      process.argv = originalArgv
    }
  })

  test("#given a revived child whose caller named an explicit list #when the respawn runner starts it #then that list is passed through untouched", async () => {
    // given: a team member respawn supplies its own array; the respawn seam must not widen it.
    const originalArgv = process.argv
    process.argv = ["bun", "omo", "-e", "/installed/omo/plugin"]
    const stopped = new Error("stop before spawning")
    const inherited: (readonly string[] | undefined)[] = []
    const start = spyOn(RpcProcessRunner.prototype, "start").mockImplementation((spec) => {
      inherited.push(spec.extensions)
      return Promise.reject(stopped)
    })
    try {
      const runner = buildRespawnRunner(
        buildContext(["/installed/provider"], ["/installed/provider/extensions/zcode.ts"]),
      )
      const explicit = ["/caller/only.ts"]

      // when
      await expect(runner.start({ ...SPEC, extensions: explicit })).rejects.toBe(stopped)

      // then
      expect(inherited[0]).toBe(explicit)
    } finally {
      start.mockRestore()
      process.argv = originalArgv
    }
  })

  test("#given package discovery that never settles #when a child starts #then the child still launches on argv extensions", async () => {
    // given: discovery stats every installed root, which can block rather than throw on a stuck
    // mount. It sits directly in front of every spawn, so a hang must degrade, not wedge the child.
    const originalArgv = process.argv
    process.argv = ["bun", "omo", "-e", "/installed/omo/plugin"]
    try {
      const runtime = new TaskRuntimeContext("/project")
      runtime.captureFrom({ loadedExtensionPaths: ["/installed/provider/extensions/zcode.ts"] })
      const resolve = createInheritedExtensionsResolver({
        runtime,
        sharedParentTools: () => [],
        settings: OmoTaskSettingsSchema.parse({ process_runner: "child-process" }),
        platform: "darwin",
        agentDir: "/agent",
        listInstalledPackageRoots: (() => new Promise(() => {})) as unknown as () => readonly string[],
      })

      // when
      const resolved = await resolve()

      // then
      expect(resolved).toEqual(["/installed/omo/plugin"])
    } finally {
      process.argv = originalArgv
    }
  }, 20_000)
})
