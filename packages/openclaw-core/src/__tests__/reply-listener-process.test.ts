import { beforeEach, describe, expect, test } from "bun:test"
import { isReplyListenerDaemonProcessWithDeps } from "../reply-listener-process"

let resolveExit: ((exitCode: number) => void) | null = null

function createOutputStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

describe("isReplyListenerDaemonProcess", () => {
  beforeEach(() => {
    resolveExit = null
  })

  test("#given injected linux proc cmdline contains daemon marker #when probing a daemon pid #then it uses proc cmdline", async () => {
    let fallbackSpawnCalls = 0

    const result = await isReplyListenerDaemonProcessWithDeps(1234, {
      platform: "linux",
      readProcCmdline: () => "bun\u0000daemon.ts\u0000--openclaw-reply-listener-daemon",
      spawn: () => {
        fallbackSpawnCalls += 1
        return {
          exitCode: 0,
          exited: Promise.resolve(0),
          stdout: createOutputStream("bun run worker.ts"),
        }
      },
    })

    expect(result).toBe(true)
    expect(fallbackSpawnCalls).toBe(0)
  })

  test("#given ps exit code resolves after stdout #when probing a daemon pid through fallback ps #then it waits before checking exitCode", async () => {
    let procReadCalls = 0

    const probe = isReplyListenerDaemonProcessWithDeps(1234, {
      platform: "darwin",
      readProcCmdline: () => {
        procReadCalls += 1
        return ""
      },
      spawn: () => {
        let exitCode: number | null = null
        const exited = new Promise<number>((resolve) => {
          resolveExit = (code: number) => {
            exitCode = code
            resolve(code)
          }
        })
        return {
          get exitCode() {
            return exitCode
          },
          exited,
          stdout: createOutputStream("bun run daemon.ts --openclaw-reply-listener-daemon"),
        }
      },
    })

    resolveExit?.(0)

    expect(await probe).toBe(true)
    expect(procReadCalls).toBe(0)
  })
})
