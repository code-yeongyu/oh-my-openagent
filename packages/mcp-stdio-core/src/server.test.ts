import { describe, expect, jest, spyOn, test } from "bun:test"
import { PassThrough, Readable, Writable } from "node:stream"
import { successResponse } from "./responses.js"
import { isProcessAlive, runJsonRpcStdioServer } from "./server.js"

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
        parentWatchdog: { pollIntervalMs: 1_000, probeAlive: () => false },
      })

      jest.advanceTimersByTime(1_000)
      await server

      expect(parentExitCalls).toBe(1)
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
      const server = runJsonRpcStdioServer({
        input,
        output,
        handlerOptions: undefined,
        idleTimeoutMs: 0,
        handler: async () => successResponse("alive", { serving: true }),
        log: (event) => {
          events.push(event)
        },
        parentWatchdog: { pollIntervalMs: 1_000 },
      })

      jest.advanceTimersByTime(3_000)

      expect(killSpy).toHaveBeenCalledTimes(3)
      expect(events).not.toContain("parent_exit")
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
      await waitForStderrEvent(createLineReader(child.stderr), "stdio_started")
      const responses = createLineReader(child.stdout)
      const deadline = Date.now() + 3 * pollIntervalMs + 1_000
      let served = 0
      while (Date.now() < deadline) {
        const id = `qa-${served}`
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "ping" })}\n`)
        await child.stdin.flush()
        const line = await Promise.race([responses.nextLine(), Bun.sleep(2_000).then(() => null)])
        expect(line).toBe(`{"jsonrpc":"2.0","id":"${id}","result":{"acknowledged":true}}`)
        served += 1
      }

      expect(served).toBeGreaterThanOrEqual(3)
      expect(isProcessAlive(child.pid)).toBe(true)
    } finally {
      killQuietly(victim.pid)
      killQuietly(child.pid)
    }
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

  test("#given the probe fails unexpectedly #when probed #then the error propagates", () => {
    const failure = Object.assign(new Error("invalid argument"), { code: "EINVAL" })
    const killSpy = spyOn(process, "kill").mockImplementation(() => {
      throw failure
    })
    try {
      expect(() => isProcessAlive(424_242)).toThrow(failure)
    } finally {
      killSpy.mockRestore()
    }
  })
})

function spawnWatchdogChild(parentPid: number, pollIntervalMs: number) {
  const serverUrl = new URL("./server.ts", import.meta.url).href
  const responsesUrl = new URL("./responses.ts", import.meta.url).href
  const script = `
    import { successResponse } from ${JSON.stringify(responsesUrl)};
    import { runJsonRpcStdioServer } from ${JSON.stringify(serverUrl)};

    await runJsonRpcStdioServer({
      input: process.stdin,
      output: process.stdout,
      handlerOptions: undefined,
      idleTimeoutMs: 0,
      handler: async (input) => successResponse(input.id, { acknowledged: true }),
      log: (event, fields) => {
        process.stderr.write(JSON.stringify({ event, ...(fields ?? {}) }) + "\\n");
      },
      parentWatchdog: {
        parentPid: Number(process.env.WATCHDOG_PARENT_PID),
        pollIntervalMs: Number(process.env.WATCHDOG_POLL_MS),
      },
    });
    process.stderr.write(JSON.stringify({ event: "server_settled" }) + "\\n");
  `
  return Bun.spawn([process.execPath, "-e", script], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      WATCHDOG_PARENT_PID: String(parentPid),
      WATCHDOG_POLL_MS: String(pollIntervalMs),
    },
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
          const line = buffer.slice(0, newlineIndex)
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

async function waitForStderrEvent(
  lines: { readonly nextLine: () => Promise<string | null> },
  event: string,
): Promise<void> {
  const found = await Promise.race([
    (async () => {
      while (true) {
        const line = await lines.nextLine()
        if (line === null) return false
        if (line.includes(`"event":"${event}"`)) return true
      }
    })(),
    Bun.sleep(5_000).then(() => false),
  ])
  if (!found) throw new Error(`timed out waiting for child event ${event}`)
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
