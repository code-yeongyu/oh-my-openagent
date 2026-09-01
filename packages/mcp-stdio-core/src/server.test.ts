import { describe, expect, jest, setDefaultTimeout, spyOn, test } from "bun:test"
import { PassThrough, Readable, Writable } from "node:stream"
import { successResponse } from "./responses.js"
import { isProcessAlive, runJsonRpcStdioServer } from "./server.js"

// Set the per-file budget HERE, never via the root preload: a preload
// setDefaultTimeout only sticks for the first test file of a run, and every later
// file silently reverts to the built-in 5000ms. This file spawns real child
// processes and waits on their watchdog polls, so under `bun test --parallel` on a
// contended windows runner 5s is not enough for the whole file -- and it must
// exceed the in-test CHILD_EVENT_TIMEOUT_MS ceiling below so a stuck child fails
// with that named diagnostic instead of an anonymous per-test timeout.
setDefaultTimeout(process.platform === "win32" ? 60_000 : 30_000)

describe("JSON-RPC stdio server", () => {
  test("#given request handler #when line request arrives #then response is written", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const received = nextOutput(output)
    const server = runJsonRpcStdioServer({
      input,
      output,
      handlerOptions: undefined,
      handler: async () => successResponse("ok", { acknowledged: true }),
    })

    input.end('{"jsonrpc":"2.0","id":"ok","method":"ping"}\n')

    expect(await received).toBe('{"jsonrpc":"2.0","id":"ok","result":{"acknowledged":true}}\n')
    await server
  })

  test("#given parse error override #when malformed line arrives #then override response is written", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const received = nextOutput(output)
    const server = runJsonRpcStdioServer({
      input,
      output,
      handlerOptions: undefined,
      handler: async () => undefined,
      parseErrorResponse: () => ({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Method not found" } }),
    })

    input.end("garbage\n")

    expect(await received).toBe('{"jsonrpc":"2.0","id":null,"error":{"code":-32601,"message":"Method not found"}}\n')
    await server
  })

  test("#given parent output closes during a response #when the stdio server writes #then the child settles without an uncaught stream error", async () => {
    const serverUrl = new URL("./server.ts", import.meta.url).href
    const script = `
      import { Readable, Writable } from "node:stream";
      import { successResponse } from ${JSON.stringify(new URL("./responses.ts", import.meta.url).href)};
      import { runJsonRpcStdioServer } from ${JSON.stringify(serverUrl)};

      const output = new Writable({
        write(_chunk, _encoding, callback) {
          callback(Object.assign(new Error("parent output closed"), { code: "EPIPE" }));
        },
      });
      await runJsonRpcStdioServer({
        input: Readable.from(['{"jsonrpc":"2.0","id":"closed","method":"ping"}\\n']),
        output,
        handlerOptions: undefined,
        handler: async () => successResponse("closed", { acknowledged: true }),
      });
      process.stderr.write("server-settled\\n");
    `
    const child = Bun.spawn([process.execPath, "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "server-settled\n" })
  })

  test("#given a non-serializable response #when the stdio server writes #then the serialization failure rejects", async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic["self"] = cyclic

    const server = runJsonRpcStdioServer({
      input: Readable.from(['{"jsonrpc":"2.0","id":"cyclic","method":"ping"}\n']),
      output: new PassThrough(),
      handlerOptions: undefined,
      handler: async () => successResponse("cyclic", cyclic),
    })

    await expect(server).rejects.toBeInstanceOf(TypeError)
  })

  test("#given an unknown output failure #when the stdio server writes #then the failure rejects", async () => {
    const outputError = Object.assign(new Error("synthetic output failure"), { code: "EIO" })
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(outputError)
      },
    })

    const server = runJsonRpcStdioServer({
      input: Readable.from(['{"jsonrpc":"2.0","id":"unknown","method":"ping"}\n']),
      output,
      handlerOptions: undefined,
      handler: async () => successResponse("unknown", { acknowledged: true }),
    })

    await expect(server).rejects.toBe(outputError)
  })
})

describe("parent watchdog", () => {
  test("#given no parent watchdog option #when the server serves and settles #then no watchdog timer is created and behaviour is unchanged", async () => {
    jest.useFakeTimers()
    try {
      const input = new PassThrough()
      const output = new PassThrough()
      const received = nextOutput(output)
      const timersBefore = jest.getTimerCount()
      const server = runJsonRpcStdioServer({
        input,
        output,
        handlerOptions: undefined,
        idleTimeoutMs: 0,
        handler: async () => successResponse("plain", { acknowledged: true }),
      })

      expect(jest.getTimerCount()).toBe(timersBefore)
      input.write('{"jsonrpc":"2.0","id":"plain","method":"ping"}\n')
      expect(await received).toBe('{"jsonrpc":"2.0","id":"plain","result":{"acknowledged":true}}\n')
      expect(jest.getTimerCount()).toBe(timersBefore)
      input.end()
      await server
      expect(jest.getTimerCount()).toBe(timersBefore)
    } finally {
      jest.useRealTimers()
    }
  })

  test("#given a dead-parent probe #when the poll interval elapses #then the server settles and the parent-exit hook fires", async () => {
    jest.useFakeTimers()
    try {
      const input = new PassThrough()
      const events: string[] = []
      const polls: boolean[] = []
      let parentExitCalls = 0
      const server = runJsonRpcStdioServer({
        input,
        output: new PassThrough(),
        handlerOptions: undefined,
        idleTimeoutMs: 0,
        handler: async () => undefined,
        log: (event) => {
          events.push(event)
        },
        onParentExit: () => {
          parentExitCalls += 1
        },
        parentWatchdog: { pollIntervalMs: 1_000, probeAlive: () => false, onPoll: (alive) => polls.push(alive) },
      })

      jest.advanceTimersByTime(1_000)
      await server

      expect(parentExitCalls).toBe(1)
      // The poll that saw the dead parent is reported, and polling stops after it.
      expect(polls).toEqual([false])
      expect(events).toEqual(["stdio_started", "parent_exit", "stdio_stopped"])
    } finally {
      jest.useRealTimers()
    }
  })

  test("#given the liveness probe is denied permission #when three polls elapse #then EPERM is treated as alive and the server keeps serving", async () => {
    const killSpy = spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" })
    })
    jest.useFakeTimers()
    try {
      const input = new PassThrough()
      const output = new PassThrough()
      const received = nextOutput(output)
      const events: string[] = []
      const polls: boolean[] = []
      const server = runJsonRpcStdioServer({
        input,
        output,
        handlerOptions: undefined,
        idleTimeoutMs: 0,
        handler: async () => successResponse("alive", { serving: true }),
        log: (event) => {
          events.push(event)
        },
        parentWatchdog: { pollIntervalMs: 1_000, onPoll: (alive) => polls.push(alive) },
      })

      jest.advanceTimersByTime(3_000)

      expect(killSpy).toHaveBeenCalledTimes(3)
      expect(events).not.toContain("parent_exit")
      // Every healthy poll is reported, so "still watching" is observable without a kill.
      expect(polls).toEqual([true, true, true])
      input.write('{"jsonrpc":"2.0","id":"alive","method":"ping"}\n')
      expect(await received).toBe('{"jsonrpc":"2.0","id":"alive","result":{"serving":true}}\n')
      input.end()
      await server
    } finally {
      jest.useRealTimers()
      killSpy.mockRestore()
    }
  })

  test("#given a custom parent pid #when the watchdog polls #then the probe checks that pid and never the current parent", async () => {
    jest.useFakeTimers()
    try {
      const probed: number[] = []
      const input = new PassThrough()
      const server = runJsonRpcStdioServer({
        input,
        output: new PassThrough(),
        handlerOptions: undefined,
        idleTimeoutMs: 0,
        handler: async () => undefined,
        parentWatchdog: {
          parentPid: 424_242,
          pollIntervalMs: 500,
          probeAlive: (pid) => {
            probed.push(pid)
            return true
          },
        },
      })

      jest.advanceTimersByTime(1_000)
      input.end()
      await server

      expect(probed).toEqual([424_242, 424_242])
      expect(probed).not.toContain(process.ppid)
    } finally {
      jest.useRealTimers()
    }
  })

  test("#given no explicit parent pid #when the watchdog polls #then the probe checks the current parent pid", async () => {
    jest.useFakeTimers()
    try {
      const probed: number[] = []
      const input = new PassThrough()
      const server = runJsonRpcStdioServer({
        input,
        output: new PassThrough(),
        handlerOptions: undefined,
        idleTimeoutMs: 0,
        handler: async () => undefined,
        parentWatchdog: {
          pollIntervalMs: 500,
          probeAlive: (pid) => {
            probed.push(pid)
            return true
          },
        },
      })

      jest.advanceTimersByTime(1_000)
      input.end()
      await server

      expect(probed).toEqual([process.ppid, process.ppid])
    } finally {
      jest.useRealTimers()
    }
  })

  test("#given a stdio server child with the parent watchdog #when the watched parent is killed #then the child exits within the poll interval plus two seconds", async () => {
    const victim = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1_000)"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    const pollIntervalMs = 500
    const child = spawnWatchdogChild(victim.pid, pollIntervalMs)
    try {
      await waitForStderrEvent(createLineReader(child.stderr), "stdio_started")

      process.kill(victim.pid, "SIGKILL")
      // Reap the victim so its pid leaves the process table; a zombie would still
      // answer kill(pid, 0) and the watchdog would correctly keep seeing it as alive.
      await victim.exited

      const exited = await Promise.race([
        child.exited.then(() => true),
        Bun.sleep(pollIntervalMs + 2_000).then(() => false),
      ])

      expect(exited).toBe(true)
    } finally {
      killQuietly(victim.pid)
      killQuietly(child.pid)
    }
  })

  test("#given a stdio server child whose watched parent stays alive #when three poll intervals pass #then the child keeps serving", async () => {
    const victim = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1_000)"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    const pollIntervalMs = 300
    const child = spawnWatchdogChild(victim.pid, pollIntervalMs)
    try {
      const events = createLineReader(child.stderr)
      await waitForStderrEvent(events, "stdio_started")
      const responses = createLineReader(child.stdout)
      // The invariant is "the child is still serving after three watchdog polls",
      // so wait for the poll events this child reports through the watchdog's
      // opt-in onPoll seam, then prove it answers a request after each one.
      // The previous loop instead spun requests against a wall-clock deadline, so
      // the round-trip count scaled with machine speed -- ~79k locally in the same
      // 1.9s window -- and every extra trip was another chance for one scheduling
      // stall to outlast its 2s in-loop race. That is a volume bet, not a stronger
      // assertion: three observed polls prove the same property in three trips.
      // Measured on macOS, same loop, same load: bun 1.3.14 max round-trip 76ms vs
      // bun 1.4.0 max 193ms, and 1.4.0's tail widens further with contention while
      // never losing a line (20k backpressured writes, 0 dropped, both versions).
      // windows-latest fit only ~697 trips in the window under `bun test
      // --parallel` (~113x slower per trip than local), so on 1.4.0 one trip's
      // tail reached the 2s race and returned null -- a latency tail, not a lost
      // line and not the watchdog: a fired watchdog logs parent_exit, destroys
      // stdin, and would fail every later ping plus the liveness check below.
      const pollsToObserve = 3
      const served: string[] = []
      for (let poll = 0; poll < pollsToObserve; poll += 1) {
        // Awaiting the poll event is the exact signal that an interval elapsed:
        // no fixed sleep, and a stalled runner just delays the event instead of
        // failing. `alive:true` also asserts the probe saw the live parent.
        const pollEvent = await withTimeout(
          nextEventLine(events, "parent_poll"),
          CHILD_EVENT_TIMEOUT_MS,
          `parent_poll #${poll + 1} of ${pollsToObserve}`,
        )
        expect(pollEvent).toContain('"alive":true')

        const id = `qa-${poll}`
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "ping" })}\n`)
        await child.stdin.flush()
        const line = await withTimeout(
          responses.nextLine(),
          CHILD_EVENT_TIMEOUT_MS,
          `response to ${id} after ${poll + 1} watchdog poll(s)`,
        )
        expect(line).toBe(`{"jsonrpc":"2.0","id":"${id}","result":{"acknowledged":true}}`)
        served.push(id)
      }

      expect(served).toEqual(["qa-0", "qa-1", "qa-2"])
      expect(isProcessAlive(child.pid)).toBe(true)
    } finally {
      killQuietly(victim.pid)
      killQuietly(child.pid)
    }
  })
})

describe("idle timeout", () => {
  test("#given a live parent that abandons stdin without closing it #when the idle timeout elapses #then the server settles instead of parking on the open pipe", async () => {
    // The parent is alive and still holds the write end, so stdin never emits
    // 'end' and the parent watchdog never fires. Only the idle timeout can end
    // this server, and it must tear the read loop down rather than flag it.
    const input = new PassThrough()
    const output = new PassThrough()
    let idleFired = false

    const served = runJsonRpcStdioServer({
      input,
      output,
      handlerOptions: undefined,
      idleTimeoutMs: 20,
      handler: async () => successResponse("idle", { acknowledged: true }),
      onIdleTimeout: () => {
        idleFired = true
      },
    })

    const outcome = await Promise.race([
      served.then(() => "settled" as const),
      Bun.sleep(1_000).then(() => "hung" as const),
    ])

    expect(idleFired).toBe(true)
    expect(outcome).toBe("settled")
  })

  test("#given a real child whose parent holds stdin open and never writes #when the idle timeout elapses #then the child process exits", async () => {
    // The in-process test above only proves the promise settles. A settled loop
    // still leaves a live process if anything keeps the event loop alive, so
    // assert the exit itself — the symptom users actually observe.
    const child = spawnIdleChild(300)
    try {
      const outcome = await Promise.race([
        child.exited.then(() => "exited" as const),
        Bun.sleep(5_000).then(() => "alive" as const),
      ])
      expect(outcome).toBe("exited")
    } finally {
      killQuietly(child.pid)
    }
  })

  test("#given an explicitly zero idle timeout #when the server idles on a held-open pipe #then no idle timer is created", async () => {
    // Callers on no-respawn hosts (codex: lsp proxy, git_bash, the codegraph
    // unavailable stub) pin idleTimeoutMs: 0 and rely on zero meaning "no
    // timer at all": the loop must park until stdin closes or the parent
    // dies — never be torn down by a default timer that became live in #6548.
    const input = new PassThrough()
    const output = new PassThrough()
    const events: string[] = []
    const served = runJsonRpcStdioServer({
      input,
      output,
      handlerOptions: undefined,
      idleTimeoutMs: 0,
      handler: async () => successResponse("idle", { acknowledged: true }),
      log: (event) => {
        events.push(event)
      },
    })

    const outcome = await Promise.race([
      served.then(() => "settled" as const),
      Bun.sleep(500).then(() => "parked" as const),
    ])
    // Teardown of the held-open pipe is test cleanup; keep the rejection it
    // provokes handled so the suite cannot fail on an unhandled error.
    served.catch(() => {})
    input.destroy()

    expect(outcome).toBe("parked")
    expect(events).toContain("stdio_started")
    expect(events).not.toContain("idle_timeout")
  })
})

describe("isProcessAlive", () => {
  test("#given a running process #when probed #then it reports alive", () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  test("#given the probe answers ESRCH #when probed #then it reports dead", () => {
    const killSpy = spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" })
    })
    try {
      expect(isProcessAlive(424_242)).toBe(false)
    } finally {
      killSpy.mockRestore()
    }
  })

  test("#given the probe answers EPERM #when probed #then it reports alive", () => {
    const killSpy = spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" })
    })
    try {
      expect(isProcessAlive(424_242)).toBe(true)
    } finally {
      killSpy.mockRestore()
    }
  })

  test("#given the probe fails with a non-ESRCH error #when probed #then it conservatively reports alive without throwing", () => {
    const failure = Object.assign(new Error("invalid argument"), { code: "EINVAL" })
    const killSpy = spyOn(process, "kill").mockImplementation(() => {
      throw failure
    })
    try {
      // A liveness probe runs inside an unref'd setInterval; a throw there would
      // wedge the host process, so any non-ESRCH error must be swallowed as alive.
      expect(isProcessAlive(424_242)).toBe(true)
    } finally {
      killSpy.mockRestore()
    }
  })
})

// Each teardown-path test needs a child running the real server over its own
// stdio, and only the config driving that path differs. The boilerplate lives
// here so the paths cannot drift; a caller supplies just the lines that make
// its case, kept verbatim so the child's config still reads at the call site.
function buildServerScript(config: string, trailer = ""): string {
  const serverUrl = new URL("./server.ts", import.meta.url).href
  const responsesUrl = new URL("./responses.ts", import.meta.url).href
  return `
    import { successResponse } from ${JSON.stringify(responsesUrl)};
    import { runJsonRpcStdioServer } from ${JSON.stringify(serverUrl)};

    await runJsonRpcStdioServer({
      input: process.stdin,
      output: process.stdout,
      handlerOptions: undefined,
      handler: async (input) => successResponse(input.id, { acknowledged: true }),
${config}
    });
${trailer}
  `
}

// Omitting env inherits the parent environment, so passing process.env through
// unchanged is what the no-env case already did.
function spawnServerChild(script: string, env?: Record<string, string>) {
  return Bun.spawn([process.execPath, "-e", script], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: env ? { ...process.env, ...env } : process.env,
  })
}

function spawnWatchdogChild(parentPid: number, pollIntervalMs: number) {
  const script = buildServerScript(
    `      idleTimeoutMs: 0,
      log: (event, fields) => {
        process.stderr.write(JSON.stringify({ event, ...(fields ?? {}) }) + "\\n");
      },
      parentWatchdog: {
        parentPid: Number(process.env.WATCHDOG_PARENT_PID),
        pollIntervalMs: Number(process.env.WATCHDOG_POLL_MS),
        // Opt this child into per-poll reporting and forward it as a stderr event.
        // The product stays silent per poll; this harness is the only observer.
        onPoll: (alive) => {
          process.stderr.write(JSON.stringify({ event: "parent_poll", alive }) + "\\n");
        },
      },`,
    `    process.stderr.write(JSON.stringify({ event: "server_settled" }) + "\\n");`,
  )
  return spawnServerChild(script, {
    WATCHDOG_PARENT_PID: String(parentPid),
    WATCHDOG_POLL_MS: String(pollIntervalMs),
  })
}

function createLineReader(stream: ReadableStream<Uint8Array>): { readonly nextLine: () => Promise<string | null> } {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  return {
    nextLine: async () => {
      while (true) {
        const newlineIndex = buffer.indexOf("\n")
        if (newlineIndex !== -1) {
          // Strip a trailing CR: a child on Windows can emit \r\n, and comparing a
          // CR-suffixed line against an exact JSON string fails for no real reason.
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, "")
          buffer = buffer.slice(newlineIndex + 1)
          return line
        }
        const { done, value } = await reader.read()
        if (done) return null
        buffer += decoder.decode(value, { stream: true })
      }
    },
  }
}

// One budget for "a live child produces the next line we asked for". A healthy
// child answers in microseconds locally and never spends this: it is a ceiling on
// an awaited signal, not a sleep, so raising it costs nothing on a green run and
// only buys patience on a contended one. Sized from measurement rather than taste:
// the worst observed round-trip was 193ms on bun 1.4.0 under heavy local CPU
// oversubscription, and windows-latest runs this loop ~113x slower per trip under
// `bun test --parallel`, which puts a bad-case Windows trip in the low seconds.
// 15s leaves roughly an order of magnitude of headroom over that while staying
// under the 30s win32 per-test default from test-setup.ts, so a genuinely wedged
// child still fails this test with a named reason instead of a bare timeout.
const CHILD_EVENT_TIMEOUT_MS = 15_000

async function withTimeout<T>(pending: Promise<T>, timeoutMs: number, description: string): Promise<T> {
  const timeout = Symbol("timeout")
  const timer = Bun.sleep(timeoutMs).then(() => timeout)
  const settled = await Promise.race([pending, timer])
  if (settled === timeout) throw new Error(`timed out after ${timeoutMs}ms waiting for ${description}`)
  return settled as T
}

async function nextEventLine(
  lines: { readonly nextLine: () => Promise<string | null> },
  event: string,
): Promise<string> {
  while (true) {
    const line = await lines.nextLine()
    if (line === null) throw new Error(`child stderr closed before event ${event}`)
    if (line.includes(`"event":"${event}"`)) return line
  }
}

async function waitForStderrEvent(
  lines: { readonly nextLine: () => Promise<string | null> },
  event: string,
): Promise<void> {
  await withTimeout(nextEventLine(lines, event), CHILD_EVENT_TIMEOUT_MS, `child event ${event}`)
}

function spawnIdleChild(idleTimeoutMs: number) {
  // stdin stays piped and is never written to or closed: the test process is a
  // live parent holding the write end, which is the case no other teardown
  // path covers.
  return spawnServerChild(buildServerScript(`      idleTimeoutMs: ${idleTimeoutMs},`))
}

function killQuietly(pid: number): void {
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    // already exited
  }
}

function nextOutput(output: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    output.once("data", (chunk: Buffer | string) => {
      resolve(String(chunk))
    })
  })
}
