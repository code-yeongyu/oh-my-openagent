import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  childEnv,
  createChildRegistry,
  type ChildHandle,
  type ChildLifecycleEvents,
  isReentry,
  type KillProcessGroup,
  REENTRY_ENV_VAR,
  runTestFast,
  shutdownChildren,
  signalExitCode,
  type SpawnChildProcess,
  spawnInheritingStdio,
  type SpawnGroupOptions,
  testFastGroups,
  type TestFastGroup,
} from "./test-fast"

describe("isReentry", () => {
  it("#given an env without the active marker #when the guard is asked #then it reports no re-entry", () => {
    // given
    const env = { PATH: "/usr/bin" }

    // when
    const reentry = isReentry(env)

    // then
    expect(reentry).toBe(false)
  })

  it("#given an env carrying the active marker #when the guard is asked #then it reports re-entry", () => {
    // given
    const env = { [REENTRY_ENV_VAR]: "1" }

    // when
    const reentry = isReentry(env)

    // then
    expect(REENTRY_ENV_VAR).toBe("OMO_TEST_FAST_ACTIVE")
    expect(reentry).toBe(true)
  })

  it("#given the marker set to an empty string #when the guard is asked #then it reports no re-entry", () => {
    // given
    const env = { [REENTRY_ENV_VAR]: "" }

    // when
    const reentry = isReentry(env)

    // then
    expect(reentry).toBe(false)
  })
})

describe("childEnv", () => {
  it("#given a parent env #when a group child env is built #then the parent entries survive and the marker is added", () => {
    // given
    const parent = { PATH: "/usr/bin", CI: "true" }

    // when
    const env = childEnv(parent)

    // then
    expect(env.PATH).toBe("/usr/bin")
    expect(env.CI).toBe("true")
    expect(env[REENTRY_ENV_VAR]).toBe("1")
    expect(isReentry(env)).toBe(true)
  })
})

describe("child registry", () => {
  const fakeChild = (pid: number, selfKills: string[]) => ({
    pid,
    kill: (signal: NodeJS.Signals) => {
      selfKills.push(`${pid}:${signal}`)
      return true
    },
  })

  it("#given two live POSIX children #when the registry kills all #then each process group receives the negated pid", () => {
    // given
    const registry = createChildRegistry("linux")
    const groupKills: string[] = []
    const selfKills: string[] = []
    registry.add(fakeChild(101, selfKills))
    registry.add(fakeChild(202, selfKills))

    // when
    registry.killAll("SIGINT", (pid, signal) => groupKills.push(`${pid}:${signal}`))

    // then
    expect(groupKills).toEqual(["-101:SIGINT", "-202:SIGINT"])
    expect(selfKills).toEqual([])
  })

  it("#given win32 has no process groups #when the registry kills all #then it falls back to killing each child handle", () => {
    // given
    const registry = createChildRegistry("win32")
    const groupKills: string[] = []
    const selfKills: string[] = []
    registry.add(fakeChild(101, selfKills))

    // when
    registry.killAll("SIGTERM", (pid, signal) => groupKills.push(`${pid}:${signal}`))

    // then
    expect(selfKills).toEqual(["101:SIGTERM"])
    expect(groupKills).toEqual([])
  })

  it("#given a POSIX group whose leader already exited #when the registry kills all #then the retained process group is still signalled", () => {
    // given — a detached group outlives its leader, so the PGID must survive the exit event
    const registry = createChildRegistry("linux")
    const groupKills: number[] = []
    const selfKills: string[] = []
    const leader = fakeChild(101, selfKills)
    registry.add(leader)
    registry.add(fakeChild(202, selfKills))
    registry.remove(leader)

    // when
    registry.killAll("SIGTERM", (pid) => groupKills.push(pid))

    // then
    expect(groupKills).toEqual([-101, -202])
  })

  it("#given a win32 child that already exited #when the registry kills all #then the reaped handle is not signalled", () => {
    // given — win32 has no process groups, so a dead handle really is nothing left to kill
    const registry = createChildRegistry("win32")
    const selfKills: string[] = []
    const first = fakeChild(101, selfKills)
    registry.add(first)
    registry.add(fakeChild(202, selfKills))
    registry.remove(first)

    // when
    registry.killAll("SIGTERM", () => {})

    // then
    expect(selfKills).toEqual(["202:SIGTERM"])
  })

  it("#given a kill that throws ESRCH for a raced child #when the registry kills all #then the remaining children are still signalled", () => {
    // given
    const registry = createChildRegistry("linux")
    const groupKills: number[] = []
    const selfKills: string[] = []
    registry.add(fakeChild(101, selfKills))
    registry.add(fakeChild(202, selfKills))

    // when
    registry.killAll("SIGINT", (pid) => {
      if (pid === -101) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" })
      groupKills.push(pid)
    })

    // then
    expect(groupKills).toEqual([-202])
  })
})

describe("shutdownChildren", () => {
  it("#given a leader that exits while a descendant ignores the signal #when the grace period elapses #then the retained group is SIGKILLed", async () => {
    // given — the leader's "exit" fires first; its process group still holds a live descendant
    const registry = createChildRegistry("linux")
    const sent: string[] = []
    const leader = { pid: 101, kill: () => true }
    registry.add(leader)
    const kill: KillProcessGroup = (pid, signal) => void sent.push(`${pid}:${signal}`)

    // when — the grace wait is where the leader's exit event lands
    await shutdownChildren(registry, "SIGTERM", kill, async () => registry.remove(leader))

    // then
    expect(sent).toEqual(["-101:SIGTERM", "-101:SIGKILL"])
  })

  it("#given win32 children that exited during the grace period #when the parent shuts down #then nothing is escalated", async () => {
    // given
    const registry = createChildRegistry("win32")
    const selfKills: string[] = []
    const child = {
      pid: 101,
      kill: (signal: NodeJS.Signals) => {
        selfKills.push(`101:${signal}`)
        return true
      },
    }
    registry.add(child)

    // when
    await shutdownChildren(registry, "SIGTERM", () => {}, async () => registry.remove(child))

    // then
    expect(selfKills).toEqual(["101:SIGTERM"])
  })

  it("#given a child still alive after the grace period #when the parent shuts down #then it is SIGKILLed before the parent exits", async () => {
    // given
    const registry = createChildRegistry("linux")
    const sent: string[] = []
    registry.add({ pid: 101, kill: () => true })

    // when
    await shutdownChildren(
      registry,
      "SIGTERM",
      (pid, signal) => sent.push(`${pid}:${signal}`),
      async () => {},
    )

    // then
    expect(sent).toEqual(["-101:SIGTERM", "-101:SIGKILL"])
  })
})

describe("signalExitCode", () => {
  it("#given a termination signal #when the exit code is derived #then it follows the 128+n convention", () => {
    // given / when / then
    expect(signalExitCode("SIGINT")).toBe(130)
    expect(signalExitCode("SIGTERM")).toBe(143)
  })
})

describe("partition tiling", () => {
  const quotedPatterns = (config: string): readonly string[] =>
    [...config.matchAll(/"([^"]+\/\*\*)"/g)].map((match) => match[1] ?? "")

  /**
   * Scopes are compared verbatim, never collapsed to their package dir: a win2
   * ignore of `packages/x/src/**` while a group runs all of `packages/x` is a
   * real overlap, and the reverse is a real coverage gap. Collapsing to
   * `packages/x` reports both as a perfect tiling.
   */
  const ignoredScopes = (base: string, win2: string): readonly string[] => {
    const basePatterns = new Set(quotedPatterns(base))
    return quotedPatterns(win2).filter((pattern) => !basePatterns.has(pattern))
  }

  const groupScopes = (groups: readonly TestFastGroup[]): readonly string[] =>
    groups
      .filter((group) => group.name !== "root-rest")
      .flatMap((group) => group.args)
      .filter((arg) => arg.startsWith("packages/"))
      .map((arg) => (arg.endsWith("/**") ? arg : `${arg}/**`))

  const sorted = (values: readonly string[]): readonly string[] => [...values].sort()

  it("#given win2 hides what the sibling groups own #when the two configs are diffed #then the extra ignores tile the non-root-rest groups exactly", () => {
    // given
    const base = readFileSync(new URL("../bunfig.toml", import.meta.url), "utf8")
    const win2 = readFileSync(new URL("../bunfig.win2.toml", import.meta.url), "utf8")

    // when
    const ignored = ignoredScopes(base, win2)
    const owned = groupScopes(testFastGroups())

    // then — the canonical tiling is whole packages on both sides, compared verbatim
    expect(sorted(owned)).toEqual([
      "packages/memory-core/**",
      "packages/omo-opencode/**",
      "packages/omo-senpi/**",
    ])
    expect(sorted(ignored)).toEqual(sorted(owned))
  })

  it("#given a win2 ignore narrowed below a package a group runs whole #when the tiling is checked #then the overlap outside that subtree is reported", () => {
    // given — win2 hides only src/, so packages/omo-senpi/test/** runs in BOTH groups
    const base = readFileSync(new URL("../bunfig.toml", import.meta.url), "utf8")
    const win2 = readFileSync(new URL("../bunfig.win2.toml", import.meta.url), "utf8").replace(
      '"packages/omo-senpi/**"',
      '"packages/omo-senpi/src/**"',
    )

    // when
    const ignored = ignoredScopes(base, win2)

    // then
    expect(ignored).toContain("packages/omo-senpi/src/**")
    expect(sorted(ignored)).not.toEqual(sorted(groupScopes(testFastGroups())))
  })

  it("#given a group argument narrowed below the package win2 hides whole #when the tiling is checked #then the uncovered subtree is reported", () => {
    // given — the senpi group runs only src/, so packages/omo-senpi/test/** runs NOWHERE
    const base = readFileSync(new URL("../bunfig.toml", import.meta.url), "utf8")
    const win2 = readFileSync(new URL("../bunfig.win2.toml", import.meta.url), "utf8")
    const narrowed = testFastGroups().map((group) =>
      group.name === "senpi"
        ? { ...group, args: ["test", "packages/omo-senpi/src"] }
        : group,
    )

    // when
    const owned = groupScopes(narrowed)

    // then
    expect(owned).toContain("packages/omo-senpi/src/**")
    expect(sorted(owned)).not.toEqual(sorted(ignoredScopes(base, win2)))
  })

  it("#given every base ignore is unconditional #when win2 is read #then it keeps all of them", () => {
    // given
    const base = readFileSync(new URL("../bunfig.toml", import.meta.url), "utf8")
    const win2 = readFileSync(new URL("../bunfig.win2.toml", import.meta.url), "utf8")

    // when
    const win2Patterns = quotedPatterns(win2)

    // then
    for (const pattern of quotedPatterns(base)) expect(win2Patterns).toContain(pattern)
  })

  it("#given each scope is owned by one group #when the sibling groups are listed #then no scope repeats", () => {
    // given
    const siblingScopes = groupScopes(testFastGroups())

    // when
    const unique = new Set(siblingScopes)

    // then
    expect(unique.size).toBe(siblingScopes.length)
  })
})

describe("spawnInheritingStdio", () => {
  /** Records the spawn contract and lets the test drive the child's lifecycle events. */
  const recordingSpawner = () => {
    const calls: {
      command: string
      args: readonly string[]
      options: SpawnGroupOptions
    }[] = []
    const listeners: {
      [E in keyof ChildLifecycleEvents]: ((payload: ChildLifecycleEvents[E]) => void)[]
    } = { error: [], exit: [] }
    const spawner: SpawnChildProcess = (command, args, options) => {
      calls.push({ command, args, options })
      const once = <E extends keyof ChildLifecycleEvents>(
        event: E,
        listener: (payload: ChildLifecycleEvents[E]) => void,
      ): unknown => {
        listeners[event].push(listener)
        return undefined
      }
      return { pid: 4242, kill: () => true, once }
    }
    return { calls, listeners, spawner }
  }

  const trackingRegistry = () => {
    const added: ChildHandle[] = []
    const removed: ChildHandle[] = []
    return {
      added,
      removed,
      registry: {
        add: (child: ChildHandle) => void added.push(child),
        remove: (child: ChildHandle) => void removed.push(child),
        hasSignalTargets: () => added.length > removed.length,
        killAll: () => {},
      },
    }
  }

  it("#given a group to run #when the child is spawned #then it carries the re-entry marker, platform detach and inherited stdio", () => {
    // given
    const { calls, spawner } = recordingSpawner()
    const { registry } = trackingRegistry()

    // when
    void spawnInheritingStdio(registry, () => {}, spawner)({
      name: "senpi",
      args: ["test", "packages/omo-senpi"],
    })

    // then
    const call = calls[0]
    expect(calls.length).toBe(1)
    expect(call?.args).toEqual(["test", "packages/omo-senpi"])
    expect(call?.options.env?.[REENTRY_ENV_VAR]).toBe("1")
    const spawnEnv = call?.options.env ?? {}
    const pathKey = Object.keys(spawnEnv).find((key) => key.toUpperCase() === "PATH") ?? "PATH"
    expect(spawnEnv[pathKey]).toBeDefined()
    expect(spawnEnv[pathKey]).toBe(process.env[pathKey])
    expect(call?.options.detached).toBe(process.platform !== "win32")
    expect(call?.options.stdio).toBe("inherit")
  })

  it("#given a spawned group #when the child starts #then it is registered and deregistered on exit", async () => {
    // given
    const { listeners, spawner } = recordingSpawner()
    const { added, removed, registry } = trackingRegistry()

    // when
    const exit = spawnInheritingStdio(registry, () => {}, spawner)({
      name: "senpi",
      args: ["test"],
    })
    expect(added.map((child) => child.pid)).toEqual([4242])
    for (const notifyExit of listeners.exit) notifyExit(7)

    // then
    expect(await exit).toBe(7)
    expect(removed.map((child) => child.pid)).toEqual([4242])
  })
})

describe("main entry re-entry guard", () => {
  it("#given the active marker in the environment #when the script runs as a real subprocess #then it exits 1 without spawning a group", async () => {
    // given
    const script = fileURLToPath(new URL("./test-fast.ts", import.meta.url))

    // when — a real process, so a deleted guard would actually launch the groups
    const child = Bun.spawn([process.execPath, "run", script], {
      env: { ...process.env, [REENTRY_ENV_VAR]: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])

    // then
    expect(exitCode).toBe(1)
    expect(stderr).toContain("re-entry blocked")
    expect(stdout).not.toContain("running 3 groups")
  })
})

describe("runTestFast", () => {
  const capturingLogger = (lines: string[]) => (line: string) => void lines.push(line)

  it("#given three fixed test groups #when the runner starts #then every group is launched before any exit is released", async () => {
    // given
    const order: string[] = []
    const spawnGroup = async (group: TestFastGroup) => {
      order.push(`start:${group.name}`)
      await Promise.resolve()
      order.push(`exit:${group.name}`)
      return 0
    }

    // when
    const exit = await runTestFast(spawnGroup, capturingLogger([]))

    // then
    expect(testFastGroups().length).toBe(3)
    expect(order.indexOf("start:senpi")).toBeLessThan(
      order.indexOf("exit:opencode-memory"),
    )
    expect(exit).toBe(0)
  })

  it("#given one nonzero group exit #when the runner aggregates #then the combined exit is 1", async () => {
    // given
    const spawnGroup = async (group: TestFastGroup) =>
      group.name === "root-rest" ? 3 : 0

    // when
    const exit = await runTestFast(spawnGroup, capturingLogger([]))

    // then
    expect(exit).toBe(1)
  })

  it("#given one group whose spawn errors #when the run aborts #then the surviving sibling groups are shut down before the error propagates", async () => {
    // given — detached siblings keep running unless someone signals them
    const shutdownAt: string[] = []
    const running = new Set<string>()
    const spawnFailure = new Error("spawn ENOENT")
    const spawnGroup = async (group: TestFastGroup) => {
      if (group.name === "root-rest") throw spawnFailure
      running.add(group.name)
      // Never settles: a detached sibling is still running when the failure lands.
      await new Promise<never>(() => {})
      return 0
    }

    // when
    const failure = await runTestFast(spawnGroup, capturingLogger([]), () => {
      shutdownAt.push([...running].sort().join(","))
    }).then(
      (exit) => `resolved:${exit}`,
      (error: unknown) => error,
    )

    // then
    expect(failure).toBe(spawnFailure)
    expect(shutdownAt).toEqual(["opencode-memory,senpi"])
  })

  it("#given every group exits normally #when the run completes #then no shutdown is triggered", async () => {
    // given
    const shutdowns: string[] = []

    // when
    const exit = await runTestFast(async () => 0, capturingLogger([]), () =>
      void shutdowns.push("shutdown"),
    )

    // then
    expect(exit).toBe(0)
    expect(shutdowns).toEqual([])
  })

  it("#given an injected logger #when the runner starts #then the banner goes to the logger and never to stdout", async () => {
    // given
    const lines: string[] = []
    const stdoutWrites: string[] = []
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutWrites.push(String(chunk))
      return true
    }) as typeof process.stdout.write

    // when
    try {
      await runTestFast(async () => 0, capturingLogger(lines))
    } finally {
      process.stdout.write = originalWrite
    }

    // then
    expect(lines).toEqual([
      "[test-fast] running 3 groups in parallel: opencode-memory, root-rest, senpi",
    ])
    expect(stdoutWrites.join("")).not.toContain("[test-fast]")
  })
})
