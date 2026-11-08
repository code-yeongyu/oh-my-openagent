import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import { probeSocket, runCheckThenTeardown, shardsCreatedBy, type SocketState, stopRunTaskHosts, type TaskHostEngine } from "./test-hermetic-home"

describe("hermetic memory home (#9469)", () => {
  test("the preload pins memory inside the temporary home", () => {
    const home = process.env.HOME
    const memory = process.env.OMO_MEMORY_HOME
    expect(home).toBeDefined()
    expect(memory).toBeDefined()
    if (!home || !memory) throw new Error("missing hermetic home")
    const path = relative(home, memory)
    expect(path).toBe(join(".omo", "memory"))
    expect(isAbsolute(path)).toBe(false)
  })
})

describe("hermetic git config (#11742)", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), "omo-hermetic-git-"))
    dirs.push(dir)
    return dir
  }

  // GIT_TRACE prints every child command git starts before starting it, so the commit's own stderr says whether it
  // left an automatic maintenance run behind: nothing here waits on timing.
  function commitTrace(env: NodeJS.ProcessEnv, repoConfig: readonly (readonly [string, string])[] = []): string {
    const dir = scratch()
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, env, encoding: "utf8" })
    git("init", "-q", "-b", "main")
    for (const [key, value] of repoConfig) git("config", key, value)
    writeFileSync(join(dir, "file.txt"), "content\n")
    git("add", "-A")
    const result = git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "probe")
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain("built-in: git commit")
    return result.stderr
  }

  const AUTO_MAINTENANCE = /run_command: git (maintenance run --auto|gc --auto)/

  test("#given the hermetic home #when a test commits #then git starts no automatic maintenance", () => {
    expect(commitTrace({ ...process.env, GIT_TRACE: "1" })).not.toMatch(AUTO_MAINTENANCE)
  })

  test("#given a child started with its own HOME #when it commits #then git starts no automatic maintenance", () => {
    expect(commitTrace({ ...process.env, GIT_TRACE: "1", HOME: scratch() })).not.toMatch(AUTO_MAINTENANCE)
  })

  test("#given a repository that turns auto maintenance back on #when it commits #then the run is not detached", () => {
    const trace = commitTrace({ ...process.env, GIT_TRACE: "1" }, [["maintenance.auto", "true"]])
    expect(trace).toMatch(/run_command: git maintenance run --auto/)
    expect(trace).not.toMatch(/run_command: git maintenance run --auto[^\n]* --detach/)
  })
})

describe("shardsCreatedBy (#9673)", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function shardsDirWith(createdBy: number, createdAt: Date): string {
    const dir = mkdtempSync(join(tmpdir(), "omo-shards-"))
    dirs.push(dir)
    writeFileSync(
      join(dir, "p-abc.meta.json"),
      JSON.stringify({ created_by_pid: createdBy, created_at: createdAt.toISOString() }),
    )
    return dir
  }

  const startedAt = Date.now() - 60_000

  test("ignores a shard naming this pid that was created before the process started", () => {
    const dir = shardsDirWith(process.pid, new Date(startedAt - 3 * 24 * 60 * 60 * 1000))
    expect(shardsCreatedBy(dir, process.pid, startedAt)).toEqual([])
  })

  test("reports a shard naming this pid that was created after the process started", () => {
    const dir = shardsDirWith(process.pid, new Date(startedAt + 1000))
    expect(shardsCreatedBy(dir, process.pid, startedAt)).toEqual([join(dir, "p-abc.meta.json")])
  })

  test("reports a shard naming this pid whose created_at cannot be parsed", () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-shards-"))
    dirs.push(dir)
    writeFileSync(join(dir, "p-abc.meta.json"), JSON.stringify({ created_by_pid: process.pid, created_at: "not a date" }))
    expect(shardsCreatedBy(dir, process.pid, startedAt)).toEqual([join(dir, "p-abc.meta.json")])
  })

  test("ignores a shard created by another pid", () => {
    const dir = shardsDirWith(process.pid + 1, new Date(startedAt + 1000))
    expect(shardsCreatedBy(dir, process.pid, startedAt)).toEqual([])
  })
})

describe("runCheckThenTeardown (#9766)", () => {
  const fail = (message: string) => () => {
    throw new Error(message)
  }

  test("#given the check throws #when run #then the teardown still runs and the check error is thrown", async () => {
    let tornDown = false
    const run = runCheckThenTeardown(async () => fail("shards")(), () => {
      tornDown = true
    })

    await expect(run).rejects.toThrow("shards")
    expect(tornDown).toBe(true)
  })

  test("#given only the teardown throws #when run #then the teardown error is thrown", async () => {
    await expect(runCheckThenTeardown(async () => {}, fail("leftovers"))).rejects.toThrow("leftovers")
  })

  test("#given both throw #when run #then the thrown message carries both, since the runner prints only that", async () => {
    const error = await runCheckThenTeardown(async () => fail("shard p-1 leaked")(), fail("left omo-x-1")).catch(
      (caught: unknown) => caught,
    )

    if (!(error instanceof AggregateError)) throw new Error(`expected an AggregateError, got ${String(error)}`)
    expect(error.message).toContain("shard p-1 leaked")
    expect(error.message).toContain("left omo-x-1")
    expect(error.errors).toHaveLength(2)
  })

  test("#given an async teardown that rejects #when run #then the rejection is thrown", async () => {
    await expect(
      runCheckThenTeardown(async () => {}, async () => {
        throw new Error("async leftovers")
      }),
    ).rejects.toThrow("async leftovers")
  })
})

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("stopRunTaskHosts (#11630)", () => {
  const dirs: string[] = []
  const children: number[] = []
  afterAll(() => {
    for (const pid of children) if (alive(pid)) process.kill(pid, "SIGKILL")
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  function agentDirWithHosts(): string {
    const dir = mkdtempSync(join(tmpdir(), "omo-agent-"))
    dirs.push(dir)
    mkdirSync(join(dir, "rpc-host-daemon"))
    return dir
  }

  function sleeper(): number {
    const child = spawn("sleep", ["30"], { stdio: "ignore" })
    if (child.pid === undefined) throw new Error("sleep did not start")
    children.push(child.pid)
    return child.pid
  }

  function engine(overrides: Partial<TaskHostEngine>): TaskHostEngine {
    return {
      listHostEndpoints: async () => [{ socket: "/run/a.sock", endpoint_kind: "rpc_host" }],
      stopHost: async () => ({ action: "refuse", reason: "unknown_owner" }),
      ...overrides,
    }
  }

  test("#given no host registry in the agent dir #when torn down #then the engine is never loaded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-agent-"))
    dirs.push(dir)
    let loaded = false
    await stopRunTaskHosts(dir, { loadEngine: async () => { loaded = true; return engine({}) } })
    expect(loaded).toBe(false)
  })

  test("#given a registered host the engine stops #when it exits #then teardown resolves", async () => {
    const pid = sleeper()
    const stops: unknown[] = []
    await stopRunTaskHosts(agentDirWithHosts(), {
      loadEngine: async () => engine({
        stopHost: async (options) => {
          stops.push(options)
          process.kill(pid, "SIGTERM")
          return { action: "stopped", pid }
        },
      }),
    })
    expect(stops).toEqual([expect.objectContaining({ socket: "/run/a.sock", force: true })])
  })

  const socketIs = (state: SocketState) => async () => state

  test("#given a host that was already gone #when the stop is refused and nothing is at its socket #then teardown resolves", async () => {
    await stopRunTaskHosts(agentDirWithHosts(), { loadEngine: async () => engine({}), probeSocket: socketIs("gone") })
  })

  test("#given a terminal endpoint #when torn down #then only rpc hosts are stopped", async () => {
    const stopped: string[] = []
    await stopRunTaskHosts(agentDirWithHosts(), {
      loadEngine: async () => engine({
        listHostEndpoints: async () => [{ socket: "/run/t.sock", endpoint_kind: "tui" }, { socket: null, endpoint_kind: "rpc_host" }],
        stopHost: async (options) => {
          stopped.push(options.socket)
          return { action: "refuse", reason: "unknown_owner" }
        },
      }),
    })
    expect(stopped).toEqual([])
  })

  test("#given a stopped host that does not exit #when the deadline passes #then a named error names it", async () => {
    const pid = sleeper()
    const error = await stopRunTaskHosts(agentDirWithHosts(), {
      deadlineMs: 200,
      loadEngine: async () => engine({ stopHost: async () => ({ action: "stopped", pid }) }),
    }).catch((caught: unknown) => caught)
    expect(String(error)).toContain("#11630")
    expect(String(error)).toContain("/run/a.sock")
    expect(String(error)).toContain(`pid ${pid}`)
  })

  test("#given a host the engine cannot prove #when it still listens #then a named error names the refusal", async () => {
    const error = await stopRunTaskHosts(agentDirWithHosts(), {
      loadEngine: async () => engine({}),
      probeSocket: socketIs("listening"),
    }).catch((caught: unknown) => caught)
    expect(String(error)).toContain("/run/a.sock")
    expect(String(error)).toContain("unknown_owner")
    expect(String(error)).toContain("still listens")
  })

  test("#given a host the engine cannot prove #when its socket gives no answer in time #then it is reported, never taken for gone", async () => {
    const error = await stopRunTaskHosts(agentDirWithHosts(), {
      loadEngine: async () => engine({}),
      probeSocket: socketIs("unknown"),
    }).catch((caught: unknown) => caught)
    expect(String(error)).toContain("#11630")
    expect(String(error)).toContain("/run/a.sock")
    expect(String(error)).toContain("may still be running")
  })

  test("#given an engine that loads slowly #when it is ready #then the stop deadline starts only then", async () => {
    const stopped: string[] = []
    await stopRunTaskHosts(agentDirWithHosts(), {
      deadlineMs: 200,
      engineWaitMs: 5_000,
      loadEngine: () => new Promise((resolve) => setTimeout(() => resolve(engine({
        stopHost: async (options) => {
          stopped.push(options.socket)
          return { action: "refuse", reason: "unknown_owner" }
        },
      })), 400)),
      probeSocket: socketIs("gone"),
    })
    expect(stopped).toEqual(["/run/a.sock"])
  })

  test("#given a stop that never settles #when the deadline passes #then teardown rejects within it, naming the host", async () => {
    const started = Date.now()
    const error = await stopRunTaskHosts(agentDirWithHosts(), {
      deadlineMs: 200,
      loadEngine: async () => engine({ stopHost: () => new Promise(() => {}) }),
    }).catch((caught: unknown) => caught)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(String(error)).toContain("/run/a.sock")
    expect(String(error)).toContain("still stopping")
  })

  test("#given an engine that never loads #when its wait passes #then teardown rejects within it, by name", async () => {
    const started = Date.now()
    const error = await stopRunTaskHosts(agentDirWithHosts(), {
      engineWaitMs: 200,
      loadEngine: () => new Promise(() => {}),
    }).catch((caught: unknown) => caught)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(String(error)).toContain("#11630")
    expect(String(error)).toContain("did not load within 200ms")
  })
})

describe("probeSocket (#11630)", () => {
  const dirs: string[] = []
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  function socketPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "omo-sock-"))
    dirs.push(dir)
    return join(dir, "h.sock")
  }

  test.skipIf(process.platform === "win32")("#given a listener #when probed #then it is listening", async () => {
    const path = socketPath()
    const server = createServer((connection) => connection.destroy())
    await new Promise<void>((resolve) => server.listen(path, resolve))
    try {
      expect(await probeSocket(path, 1_000)).toBe("listening")
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  test.skipIf(process.platform === "win32")("#given no socket file #when probed #then it is gone", async () => {
    expect(await probeSocket(socketPath(), 1_000)).toBe("gone")
  })

  test.skipIf(process.platform === "win32")("#given a socket file its listener left behind #when probed #then it is gone", async () => {
    const path = socketPath()
    // A host killed outright leaves its socket file with nothing listening on it.
    const holder = spawn(process.execPath, ["-e", `require("node:net").createServer().listen(${JSON.stringify(path)}, () => console.log("ready"))`], {
      stdio: ["ignore", "pipe", "ignore"],
    })
    await new Promise<void>((resolve) => holder.stdout.once("data", () => resolve()))
    const exited = new Promise((resolve) => holder.once("exit", resolve))
    holder.kill("SIGKILL")
    await exited
    expect(await probeSocket(path, 1_000)).toBe("gone")
  })
})
