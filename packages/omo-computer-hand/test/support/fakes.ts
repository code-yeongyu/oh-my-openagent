import { PassThrough } from "node:stream"

import type { DaemonChild, DaemonLink, RpcReply } from "../../src/index.ts"

export interface FakeChild extends DaemonChild {
  readonly written: () => string
  readonly killed: () => boolean
}

export function fakeChild(pid = 7): FakeChild {
  const stdin = new PassThrough()
  let text = ""
  stdin.on("data", (chunk: Buffer) => {
    text += chunk.toString()
  })
  let killed = false
  let exit: () => void = () => undefined
  const exited = new Promise<void>((resolve) => {
    exit = resolve
  })
  return {
    pid,
    stdin,
    exited,
    kill: () => {
      killed = true
      exit()
    },
    written: () => text,
    killed: () => killed,
  }
}

/** An authority link that mints a distinct capability per hand.register and records every call. */
export function fakeAuthority(): DaemonLink & { readonly calls: Array<{ method: string; params: unknown }> } {
  const calls: Array<{ method: string; params: unknown }> = []
  let minted = 0
  let close: () => void = () => undefined
  const closed = new Promise<void>((resolve) => {
    close = resolve
  })
  return {
    calls,
    closed,
    close,
    onNotification: () => () => undefined,
    call: async (method, params): Promise<RpcReply> => {
      calls.push({ method, params })
      if (method === "hand.register") {
        minted += 1
        return { id: calls.length, result: { capability: minted.toString(16).padStart(64, "0") } }
      }
      return { id: calls.length, result: null }
    },
  }
}
