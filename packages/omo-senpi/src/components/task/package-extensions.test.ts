import { describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { RpcHostRunner, RpcProcessRunner } from "@oh-my-opencode/senpi-task"

import { loadSenpiBarrel } from "../../../../senpi-task/src/lazy/senpi-barrel"
import { DEFAULT_RUNNER_FACTORIES } from "./engine-runners"
import { TaskRuntimeContext } from "./runtime-context"

describe("package extension inheritance", () => {
  test("#given one managed host runner #when starting twice consecutively #then both starts use the same underlying instance", async () => {
    const instances: RpcHostRunner[] = []
    const stopped = new Error("stop before spawning")
    const start = spyOn(RpcHostRunner.prototype, "start").mockImplementation(function (this: RpcHostRunner) {
      instances.push(this)
      return Promise.reject(stopped)
    })
    try {
      const runner = DEFAULT_RUNNER_FACTORIES.process({
        runtime: new TaskRuntimeContext("/project"),
        sharedParentTools: () => [],
        settings: OmoTaskSettingsSchema.parse({ process_runner: "host" }),
        platform: "darwin",
        agentDir: "/agent",
      })
      const spec = {
        taskId: "st_package",
        cwd: "/project",
        stateDir: "/state",
        prompt: "test",
        depth: 1,
        parentSessionId: "parent",
        rootSessionId: "parent",
      }
      await expect(runner.start(spec)).rejects.toBe(stopped)
      await expect(runner.start(spec)).rejects.toBe(stopped)
      expect(instances).toHaveLength(2)
      expect(instances[0]).toBe(instances[1])
    } finally {
      start.mockRestore()
    }
  })

  test("#given no package-root override #when the real package lookup is empty or throws #then argv-only extensions still reach the runner", async () => {
    const { DefaultPackageManager } = await loadSenpiBarrel()
    const cwd = mkdtempSync(join(tmpdir(), "omo-package-extensions-"))
    const originalArgv = process.argv
    process.argv = ["bun", "omo", "-e", "/installed/omo/plugin"]
    const stopped = new Error("stop before spawning")
    const inherited: (readonly string[] | undefined)[] = []
    const start = spyOn(RpcProcessRunner.prototype, "start").mockImplementation((spec) => {
      inherited.push(spec.extensions)
      return Promise.reject(stopped)
    })
    const list = spyOn(DefaultPackageManager.prototype, "listConfiguredPackages")
    try {
      const runtime = new TaskRuntimeContext(cwd)
      runtime.captureFrom({ loadedExtensionPaths: ["/installed/omo/plugin/extensions/omo.js", "/agent/extensions/local.ts"] })
      const runner = DEFAULT_RUNNER_FACTORIES.process({
        runtime,
        sharedParentTools: () => [],
        settings: OmoTaskSettingsSchema.parse({ process_runner: "child-process" }),
        agentDir: join(cwd, "agent"),
      })
      const spec = {
        taskId: "st_package",
        cwd,
        stateDir: join(cwd, "state"),
        prompt: "test",
        depth: 1,
        parentSessionId: "parent",
        rootSessionId: "parent",
      }
      await expect(runner.start(spec)).rejects.toBe(stopped)
      expect(list).toHaveBeenCalledTimes(1)
      expect(list.mock.results[0]?.value).toEqual([])
      list.mockImplementation(() => { throw new Error("package discovery unavailable") })
      await expect(runner.start(spec)).rejects.toBe(stopped)
      expect(list).toHaveBeenCalledTimes(2)
      expect(inherited).toEqual([["/installed/omo/plugin"], ["/installed/omo/plugin"]])
    } finally {
      list.mockRestore()
      start.mockRestore()
      process.argv = originalArgv
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("#given argv entries and loaded package paths #when starting a child runner #then argv stays first and omo is not duplicated", async () => {
    const originalArgv = process.argv
    process.argv = ["bun", "omo", "-e", "/installed/omo/plugin", "-e", "/explicit.ts"]
    const stopped = new Error("stop before spawning")
    let inherited: readonly string[] = []
    const start = spyOn(RpcProcessRunner.prototype, "start").mockImplementation(function (this: RpcProcessRunner, spec) {
      inherited = spec.extensions ?? this["inheritedExtensions"]
      return Promise.reject(stopped)
    })
    try {
      const runtime = new TaskRuntimeContext("/project")
      const live = { loadedExtensionPaths: [
        "/installed/omo/plugin/extensions/omo.js",
        "/installed/provider/extensions/index.ts",
        "/agent/extensions/local.ts",
      ], cwd: "/project" }
      runtime.captureFrom(live)
      const build = {
        runtime,
        sharedParentTools: () => [],
        settings: OmoTaskSettingsSchema.parse({ process_runner: "child-process" }),
        listInstalledPackageRoots: () => ["/installed/omo", "/installed/provider"],
      }
      const runner = DEFAULT_RUNNER_FACTORIES.process(build)
      await expect(runner.start({
        taskId: "st_package",
        cwd: "/project",
        stateDir: "/state",
        prompt: "test",
        depth: 1,
        parentSessionId: "parent",
        rootSessionId: "parent",
      })).rejects.toBe(stopped)
      expect(inherited).toEqual([
        "/installed/omo/plugin",
        "/explicit.ts",
        "/installed/provider/extensions/index.ts",
      ])
    } finally {
      start.mockRestore()
      process.argv = originalArgv
    }
  })

  test("#given runtime captured after registration #when a task starts #then package extensions reach the runner", async () => {
    const originalArgv = process.argv
    process.argv = ["bun", "omo", "-e", "/installed/omo/plugin"]
    const stopped = new Error("stop before spawning")
    let inherited: readonly string[] = []
    const start = spyOn(RpcProcessRunner.prototype, "start").mockImplementation(function (this: RpcProcessRunner, spec) {
      inherited = spec.extensions ?? this["inheritedExtensions"]
      return Promise.reject(stopped)
    })
    try {
      const runtime = new TaskRuntimeContext("/project")
      const build = {
        runtime,
        sharedParentTools: () => [],
        settings: OmoTaskSettingsSchema.parse({ process_runner: "child-process" }),
        listInstalledPackageRoots: () => ["/installed/provider"],
      }
      const runner = DEFAULT_RUNNER_FACTORIES.process(build)
      const live = { cwd: "/project", loadedExtensionPaths: ["/installed/provider/extensions/index.ts"] }
      runtime.captureFrom(live)
      await expect(runner.start({
        taskId: "st_package",
        cwd: "/project",
        stateDir: "/state",
        prompt: "test",
        depth: 1,
        parentSessionId: "parent",
        rootSessionId: "parent",
      })).rejects.toBe(stopped)
      expect(inherited).toEqual(["/installed/omo/plugin", "/installed/provider/extensions/index.ts"])
    } finally {
      start.mockRestore()
      process.argv = originalArgv
    }
  })

  for (const processRunner of ["host", "child-process"] as const) {
    test(`#given a ${processRunner} runner #when contexts and installed packages change between spawns #then one runner is reused and caller extensions win`, async () => {
      const originalArgv = process.argv
      process.argv = ["bun", "omo", "-e", "/installed/omo/plugin"]
      const stopped = new Error("stop before spawning")
      const instances = new Set<RpcHostRunner | RpcProcessRunner>()
      const inherited: (readonly string[])[] = []
      const prototype = processRunner === "host" ? RpcHostRunner.prototype : RpcProcessRunner.prototype
      const start = spyOn(prototype, "start").mockImplementation(function (this: RpcHostRunner | RpcProcessRunner, spec) {
        instances.add(this)
        inherited.push(spec.extensions ?? (this instanceof RpcHostRunner
          ? this["inheritedExtensions"]
          : this["inheritedExtensions"]))
        return Promise.reject(stopped)
      })
      try {
        const runtime = new TaskRuntimeContext("/project")
        let roots = ["/installed/first"]
        let resolutions = 0
        const runner = DEFAULT_RUNNER_FACTORIES.process({
          runtime,
          sharedParentTools: () => [],
          settings: OmoTaskSettingsSchema.parse({ process_runner: processRunner }),
          platform: "darwin",
          agentDir: "/agent",
          listInstalledPackageRoots: () => {
            resolutions += 1
            return roots
          },
        })
        const spec = {
          taskId: "st_package",
          cwd: "/project",
          stateDir: "/state",
          prompt: "test",
          depth: 1,
          parentSessionId: "parent",
          rootSessionId: "parent",
        }
        runtime.captureFrom({ loadedExtensionPaths: ["/installed/first/index.ts"] })
        await expect(runner.start(spec)).rejects.toBe(stopped)
        roots = ["/installed/second"]
        runtime.captureFrom({ loadedExtensionPaths: ["/installed/second/index.ts"] })
        await expect(runner.start(spec)).rejects.toBe(stopped)
        const explicit = ["/caller/provider.ts"]
        await expect(runner.start({ ...spec, extensions: explicit })).rejects.toBe(stopped)
        const empty: readonly string[] = []
        await expect(runner.start({ ...spec, extensions: empty })).rejects.toBe(stopped)
        expect(inherited).toEqual([
          ["/installed/omo/plugin", "/installed/first/index.ts"],
          ["/installed/omo/plugin", "/installed/second/index.ts"],
          explicit,
          empty,
        ])
        expect(instances.size).toBe(1)
        expect(resolutions).toBe(2)
        expect(inherited[2]).toBe(explicit)
        expect(inherited[3]).toBe(empty)
      } finally {
        start.mockRestore()
        process.argv = originalArgv
      }
    })
  }
})
