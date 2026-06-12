import { beforeAll, describe, expect, mock, test } from "bun:test"

let resolveExit: ((exitCode: number) => void) | null = null

function createOutputStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

beforeAll(() => {
  mock.module("@oh-my-opencode/utils/runtime", () => ({
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
        stderr: createOutputStream(""),
      }
    },
  }))
})

describe("isReplyListenerDaemonProcess", () => {
  test("#given ps exit code resolves after stdout #when probing a daemon pid #then it waits before checking exitCode", async () => {
    const { isReplyListenerDaemonProcess } = await import("../reply-listener-process")
    const probe = isReplyListenerDaemonProcess(1234)

    resolveExit?.(0)

    expect(await probe).toBe(true)
  })
})
