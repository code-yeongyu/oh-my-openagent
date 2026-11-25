import { afterEach, describe, expect, test } from "bun:test"

import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

/**
 * Slice T1b (#14951), deliverable 1: what each thread read and control answers TODAY on every surface of this package
 * that has it - the thread tool (`run`) and the thread SDK (`sdk`) - for a thread on this device (`dur-local`) and one on
 * device b (`dur-on-b`), through the real controls over one scripted holder. These pins are written on unmodified code
 * and stay unmodified while the bodies move into the thread core; a cell where the tool and the SDK differ is a listed
 * difference the design lane rules on, never a silent pick. `omo thread` is pinned in omo-native (thread-cli-pins).
 */

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const LEGS = { here: "dur-local", b: "dur-on-b" } as const
type Leg = keyof typeof LEGS

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g
function stable(value: unknown, key = ""): unknown {
  if (typeof value === "string")
    return value.split(process.cwd()).join("<cwd>").replace(UUID, "<uuid>").replace(ISO, "<time>")
  if (typeof value === "number" && key === "waited_ms") return "<waited>"
  if (typeof value === "number" && /(_at|_ms|At|Ms)$/.test(key) && value > 1_000_000_000) return "<time>"
  if (Array.isArray(value)) return value.map((item) => stable(item))
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stable(v, k)]))
  return value
}

function fresh() {
  const a = account()
  const s = surface(a.remote)
  const sdk = s.sdk()
  const tool = async (name: ThreadToolName, args: unknown) => stable(await s.run(name, args)) as ThreadToolResult
  return { a, s, sdk, tool }
}

async function table(
  legs: readonly Leg[],
  surfaces: Record<string, (thread: string) => Promise<unknown>>,
): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [name, call] of Object.entries(surfaces)) {
    out[name] = {}
    for (const leg of legs) out[name][leg] = stable(await call(LEGS[leg]))
  }
  return out
}

describe("T1b pins: reads", () => {
  test("list: no input, a state filter, all_scope, and a filter only the remote module has", async () => {
    const { sdk, tool } = fresh()
    const pins = {
      plain: { tool: await tool("thread_list", {}), sdk: stable(await sdk.list({})) },
      idle: { tool: await tool("thread_list", { state: ["idle"] }), sdk: stable(await sdk.list({ state: ["idle"] })) },
      all_scope: {
        tool: await tool("thread_list", { all_scope: true }),
        sdk: stable(await sdk.list({ all_scope: true })),
      },
      device: {
        tool: await tool("thread_list", { device: "b" }),
        sdk: stable(await sdk.list({ device: "b" } as never)),
      },
      keyed: {
        tool: await tool("thread_list", { idempotency_key: "k-list" }),
        sdk: stable(await sdk.list({ idempotency_key: "k-list" } as never)),
      },
    }
    expect(pins).toMatchInlineSnapshot(`
      {
        "all_scope": {
          "sdk": {
            "devices": [
              {
                "device": "here",
                "last_seen": null,
                "listing": "listed",
                "name": "this mac",
                "online": true,
                "this_device": true,
                "threads": 1,
              },
              {
                "device": "b",
                "last_seen": null,
                "listing": "listed",
                "name": "studio",
                "online": true,
                "this_device": false,
                "threads": 1,
              },
            ],
            "kind": "ok",
            "scope": "all",
            "threads": [
              {
                "created_at": "<time>",
                "cwd": "<cwd>",
                "link": "[local peer](omo-thread://v1/dur-local)",
                "machine": "this mac",
                "name": "local peer",
                "state": "idle",
                "status": "live",
                "surface": "daemon",
                "thread": "dur-local",
                "updated_at": null,
              },
              {
                "created_at": "<time>",
                "cwd": "/work/b",
                "device": "b",
                "link": "[on b](omo-thread://v1/dur-on-b)",
                "machine": "studio",
                "name": "on b",
                "state": "idle",
                "status": "live",
                "thread": "dur-on-b",
                "updated_at": "<time>",
              },
            ],
          },
          "tool": {
            "devices": [
              {
                "device": "here",
                "last_seen": null,
                "listing": "listed",
                "name": "this mac",
                "online": true,
                "this_device": true,
                "threads": 1,
              },
              {
                "device": "b",
                "last_seen": null,
                "listing": "listed",
                "name": "studio",
                "online": true,
                "this_device": false,
                "threads": 1,
              },
            ],
            "kind": "ok",
            "scope": "all",
            "threads": [
              {
                "created_at": "<time>",
                "cwd": "<cwd>",
                "link": "[local peer](omo-thread://v1/dur-local)",
                "machine": "this mac",
                "name": "local peer",
                "state": "idle",
                "status": "live",
                "surface": "daemon",
                "thread": "dur-local",
                "updated_at": null,
              },
              {
                "created_at": "<time>",
                "cwd": "/work/b",
                "device": "b",
                "link": "[on b](omo-thread://v1/dur-on-b)",
                "machine": "studio",
                "name": "on b",
                "state": "idle",
                "status": "live",
                "thread": "dur-on-b",
                "updated_at": "<time>",
              },
            ],
          },
        },
        "device": {
          "sdk": {
            "error": {
              "code": "invalid_arguments",
              "details": {
                "unknown": [
                  "device",
                ],
              },
              "message": "Unknown option: device.",
              "next_action": "Pass only all_scope, state.",
            },
            "kind": "error",
          },
          "tool": {
            "error": {
              "code": "invalid_arguments",
              "details": {
                "accepted": [
                  "all_scope",
                  "state",
                  "idempotency_key",
                ],
                "field": "device",
              },
              "message": "This tool takes no field "device" Nothing was done.",
              "next_action": "Call the tool again without "device"; it takes: all_scope, state, idempotency_key.",
            },
            "kind": "error",
          },
        },
        "idle": {
          "sdk": {
            "devices": [
              {
                "device": "here",
                "last_seen": null,
                "listing": "listed",
                "name": "this mac",
                "online": true,
                "this_device": true,
                "threads": 1,
              },
              {
                "device": "b",
                "last_seen": null,
                "listing": "listed",
                "name": "studio",
                "online": true,
                "this_device": false,
                "threads": 1,
              },
            ],
            "kind": "ok",
            "scope": "workspace",
            "threads": [
              {
                "created_at": "<time>",
                "cwd": "<cwd>",
                "link": "[local peer](omo-thread://v1/dur-local)",
                "machine": "this mac",
                "name": "local peer",
                "state": "idle",
                "status": "live",
                "surface": "daemon",
                "thread": "dur-local",
                "updated_at": null,
              },
              {
                "created_at": "<time>",
                "cwd": "/work/b",
                "device": "b",
                "link": "[on b](omo-thread://v1/dur-on-b)",
                "machine": "studio",
                "name": "on b",
                "state": "idle",
                "status": "live",
                "thread": "dur-on-b",
                "updated_at": "<time>",
              },
            ],
          },
          "tool": {
            "devices": [
              {
                "device": "here",
                "last_seen": null,
                "listing": "listed",
                "name": "this mac",
                "online": true,
                "this_device": true,
                "threads": 1,
              },
              {
                "device": "b",
                "last_seen": null,
                "listing": "listed",
                "name": "studio",
                "online": true,
                "this_device": false,
                "threads": 1,
              },
            ],
            "kind": "ok",
            "scope": "workspace",
            "threads": [
              {
                "created_at": "<time>",
                "cwd": "<cwd>",
                "link": "[local peer](omo-thread://v1/dur-local)",
                "machine": "this mac",
                "name": "local peer",
                "state": "idle",
                "status": "live",
                "surface": "daemon",
                "thread": "dur-local",
                "updated_at": null,
              },
              {
                "created_at": "<time>",
                "cwd": "/work/b",
                "device": "b",
                "link": "[on b](omo-thread://v1/dur-on-b)",
                "machine": "studio",
                "name": "on b",
                "state": "idle",
                "status": "live",
                "thread": "dur-on-b",
                "updated_at": "<time>",
              },
            ],
          },
        },
        "keyed": {
          "sdk": {
            "error": {
              "code": "invalid_arguments",
              "details": {
                "unknown": [
                  "idempotency_key",
                ],
              },
              "message": "Unknown option: idempotency_key.",
              "next_action": "Pass only all_scope, state.",
            },
            "kind": "error",
          },
          "tool": {
            "devices": [
              {
                "device": "here",
                "last_seen": null,
                "listing": "listed",
                "name": "this mac",
                "online": true,
                "this_device": true,
                "threads": 1,
              },
              {
                "device": "b",
                "last_seen": null,
                "listing": "listed",
                "name": "studio",
                "online": true,
                "this_device": false,
                "threads": 1,
              },
            ],
            "kind": "ok",
            "scope": "workspace",
            "threads": [
              {
                "created_at": "<time>",
                "cwd": "<cwd>",
                "link": "[local peer](omo-thread://v1/dur-local)",
                "machine": "this mac",
                "name": "local peer",
                "state": "idle",
                "status": "live",
                "surface": "daemon",
                "thread": "dur-local",
                "updated_at": null,
              },
              {
                "created_at": "<time>",
                "cwd": "/work/b",
                "device": "b",
                "link": "[on b](omo-thread://v1/dur-on-b)",
                "machine": "studio",
                "name": "on b",
                "state": "idle",
                "status": "live",
                "thread": "dur-on-b",
                "updated_at": "<time>",
              },
            ],
          },
        },
        "plain": {
          "sdk": {
            "devices": [
              {
                "device": "here",
                "last_seen": null,
                "listing": "listed",
                "name": "this mac",
                "online": true,
                "this_device": true,
                "threads": 1,
              },
              {
                "device": "b",
                "last_seen": null,
                "listing": "listed",
                "name": "studio",
                "online": true,
                "this_device": false,
                "threads": 1,
              },
            ],
            "kind": "ok",
            "scope": "workspace",
            "threads": [
              {
                "created_at": "<time>",
                "cwd": "<cwd>",
                "link": "[local peer](omo-thread://v1/dur-local)",
                "machine": "this mac",
                "name": "local peer",
                "state": "idle",
                "status": "live",
                "surface": "daemon",
                "thread": "dur-local",
                "updated_at": null,
              },
              {
                "created_at": "<time>",
                "cwd": "/work/b",
                "device": "b",
                "link": "[on b](omo-thread://v1/dur-on-b)",
                "machine": "studio",
                "name": "on b",
                "state": "idle",
                "status": "live",
                "thread": "dur-on-b",
                "updated_at": "<time>",
              },
            ],
          },
          "tool": {
            "devices": [
              {
                "device": "here",
                "last_seen": null,
                "listing": "listed",
                "name": "this mac",
                "online": true,
                "this_device": true,
                "threads": 1,
              },
              {
                "device": "b",
                "last_seen": null,
                "listing": "listed",
                "name": "studio",
                "online": true,
                "this_device": false,
                "threads": 1,
              },
            ],
            "kind": "ok",
            "scope": "workspace",
            "threads": [
              {
                "created_at": "<time>",
                "cwd": "<cwd>",
                "link": "[local peer](omo-thread://v1/dur-local)",
                "machine": "this mac",
                "name": "local peer",
                "state": "idle",
                "status": "live",
                "surface": "daemon",
                "thread": "dur-local",
                "updated_at": null,
              },
              {
                "created_at": "<time>",
                "cwd": "/work/b",
                "device": "b",
                "link": "[on b](omo-thread://v1/dur-on-b)",
                "machine": "studio",
                "name": "on b",
                "state": "idle",
                "status": "live",
                "thread": "dur-on-b",
                "updated_at": "<time>",
              },
            ],
          },
        },
      }
    `)
  })

  test("read: plain, with a byte budget, and with the inputs only the tool takes (idempotency_key, delivery_id, wait_ms)", async () => {
    const { sdk, tool } = fresh()
    const pins = {
      plain: await table(["here", "b"], {
        tool: (thread) => tool("thread_read", { thread }),
        sdk: (thread) => sdk.read({ thread }),
      }),
      max_bytes: await table(["here", "b"], {
        tool: (thread) => tool("thread_read", { thread, max_bytes: 16 }),
        sdk: (thread) => sdk.read({ thread, max_bytes: 16 }),
      }),
      keyed: await table(["here"], {
        tool: (thread) => tool("thread_read", { thread, idempotency_key: "k-read" }),
        sdk: (thread) => sdk.read({ thread, idempotency_key: "k-read" } as never),
      }),
      wait: await table(["here", "b"], {
        tool: (thread) => tool("thread_read", { thread, wait_ms: 1 }),
        sdk: (thread) => sdk.read({ thread, wait_ms: 1 } as never),
      }),
    }
    expect(pins).toMatchInlineSnapshot(`
      {
        "keyed": {
          "sdk": {
            "here": {
              "error": {
                "code": "invalid_arguments",
                "details": {
                  "unknown": [
                    "idempotency_key",
                  ],
                },
                "message": "Unknown option: idempotency_key.",
                "next_action": "Pass only thread, max_bytes, cursor, all_scope.",
              },
              "kind": "error",
            },
          },
          "tool": {
            "here": {
              "items": [
                {
                  "content": ""message 0 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 1,
                },
                {
                  "content": ""message 1 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 2,
                },
                {
                  "content": ""message 2 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 3,
                },
                {
                  "content": ""message 3 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 4,
                },
                {
                  "content": ""message 4 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 5,
                },
                {
                  "content": ""message 5 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 6,
                },
                {
                  "content": ""message 6 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 7,
                },
                {
                  "content": ""message 7 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 8,
                },
                {
                  "content": ""message 8 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 9,
                },
                {
                  "content": ""message 9 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 10,
                },
                {
                  "content": ""message 10 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 11,
                },
                {
                  "content": ""message 11 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 12,
                },
                {
                  "content": ""message 12 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 13,
                },
                {
                  "content": ""message 13 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 14,
                },
                {
                  "content": ""message 14 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 15,
                },
                {
                  "content": ""message 15 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 16,
                },
                {
                  "content": ""message 16 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 17,
                },
                {
                  "content": ""message 17 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 18,
                },
                {
                  "content": ""message 18 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 19,
                },
                {
                  "content": ""message 19 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 20,
                },
                {
                  "content": ""message 20 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 21,
                },
                {
                  "content": ""message 21 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 22,
                },
                {
                  "content": ""message 22 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 23,
                },
                {
                  "content": ""message 23 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 24,
                },
                {
                  "content": ""message 24 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 25,
                },
                {
                  "content": ""message 25 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 26,
                },
                {
                  "content": ""message 26 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 27,
                },
                {
                  "content": ""message 27 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 28,
                },
                {
                  "content": ""message 28 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 29,
                },
                {
                  "content": ""message 29 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 30,
                },
              ],
              "kind": "ok",
              "link": "[local peer](omo-thread://v1/dur-local)",
              "source": "live_host",
              "thread": "dur-local",
              "truncated": false,
            },
          },
        },
        "max_bytes": {
          "sdk": {
            "b": {
              "device": "b",
              "items": [
                {
                  "content": ""message 29 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 1,
                },
              ],
              "kind": "ok",
              "link": "[on b](omo-thread://v1/dur-on-b)",
              "next_cursor": "dDFvOjMwLm1tYjI2ZDoyOTow",
              "source": "live_host",
              "thread": "dur-on-b",
              "truncated": true,
            },
            "here": {
              "items": [
                {
                  "content": ""message 29 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 1,
                },
              ],
              "kind": "ok",
              "link": "[local peer](omo-thread://v1/dur-local)",
              "next_cursor": "dDFvOjMwLm1tYjI2ZDoyOTow",
              "source": "live_host",
              "thread": "dur-local",
              "truncated": true,
            },
          },
          "tool": {
            "b": {
              "device": "b",
              "items": [
                {
                  "content": ""message 29 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 1,
                },
              ],
              "kind": "ok",
              "link": "[on b](omo-thread://v1/dur-on-b)",
              "next_cursor": "dDFvOjMwLm1tYjI2ZDoyOTow",
              "source": "live_host",
              "thread": "dur-on-b",
              "truncated": true,
            },
            "here": {
              "items": [
                {
                  "content": ""message 29 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 1,
                },
              ],
              "kind": "ok",
              "link": "[local peer](omo-thread://v1/dur-local)",
              "next_cursor": "dDFvOjMwLm1tYjI2ZDoyOTow",
              "source": "live_host",
              "thread": "dur-local",
              "truncated": true,
            },
          },
        },
        "plain": {
          "sdk": {
            "b": {
              "device": "b",
              "items": [
                {
                  "content": ""message 0 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 1,
                },
                {
                  "content": ""message 1 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 2,
                },
                {
                  "content": ""message 2 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 3,
                },
                {
                  "content": ""message 3 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 4,
                },
                {
                  "content": ""message 4 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 5,
                },
                {
                  "content": ""message 5 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 6,
                },
                {
                  "content": ""message 6 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 7,
                },
                {
                  "content": ""message 7 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 8,
                },
                {
                  "content": ""message 8 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 9,
                },
                {
                  "content": ""message 9 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 10,
                },
                {
                  "content": ""message 10 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 11,
                },
                {
                  "content": ""message 11 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 12,
                },
                {
                  "content": ""message 12 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 13,
                },
                {
                  "content": ""message 13 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 14,
                },
                {
                  "content": ""message 14 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 15,
                },
                {
                  "content": ""message 15 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 16,
                },
                {
                  "content": ""message 16 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 17,
                },
                {
                  "content": ""message 17 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 18,
                },
                {
                  "content": ""message 18 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 19,
                },
                {
                  "content": ""message 19 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 20,
                },
                {
                  "content": ""message 20 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 21,
                },
                {
                  "content": ""message 21 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 22,
                },
                {
                  "content": ""message 22 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 23,
                },
                {
                  "content": ""message 23 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 24,
                },
                {
                  "content": ""message 24 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 25,
                },
                {
                  "content": ""message 25 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 26,
                },
                {
                  "content": ""message 26 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 27,
                },
                {
                  "content": ""message 27 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 28,
                },
                {
                  "content": ""message 28 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 29,
                },
                {
                  "content": ""message 29 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 30,
                },
              ],
              "kind": "ok",
              "link": "[on b](omo-thread://v1/dur-on-b)",
              "source": "live_host",
              "thread": "dur-on-b",
              "truncated": false,
            },
            "here": {
              "items": [
                {
                  "content": ""message 0 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 1,
                },
                {
                  "content": ""message 1 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 2,
                },
                {
                  "content": ""message 2 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 3,
                },
                {
                  "content": ""message 3 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 4,
                },
                {
                  "content": ""message 4 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 5,
                },
                {
                  "content": ""message 5 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 6,
                },
                {
                  "content": ""message 6 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 7,
                },
                {
                  "content": ""message 7 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 8,
                },
                {
                  "content": ""message 8 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 9,
                },
                {
                  "content": ""message 9 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 10,
                },
                {
                  "content": ""message 10 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 11,
                },
                {
                  "content": ""message 11 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 12,
                },
                {
                  "content": ""message 12 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 13,
                },
                {
                  "content": ""message 13 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 14,
                },
                {
                  "content": ""message 14 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 15,
                },
                {
                  "content": ""message 15 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 16,
                },
                {
                  "content": ""message 16 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 17,
                },
                {
                  "content": ""message 17 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 18,
                },
                {
                  "content": ""message 18 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 19,
                },
                {
                  "content": ""message 19 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 20,
                },
                {
                  "content": ""message 20 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 21,
                },
                {
                  "content": ""message 21 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 22,
                },
                {
                  "content": ""message 22 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 23,
                },
                {
                  "content": ""message 23 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 24,
                },
                {
                  "content": ""message 24 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 25,
                },
                {
                  "content": ""message 25 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 26,
                },
                {
                  "content": ""message 26 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 27,
                },
                {
                  "content": ""message 27 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 28,
                },
                {
                  "content": ""message 28 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 29,
                },
                {
                  "content": ""message 29 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 30,
                },
              ],
              "kind": "ok",
              "link": "[local peer](omo-thread://v1/dur-local)",
              "source": "live_host",
              "thread": "dur-local",
              "truncated": false,
            },
          },
          "tool": {
            "b": {
              "device": "b",
              "items": [
                {
                  "content": ""message 0 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 1,
                },
                {
                  "content": ""message 1 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 2,
                },
                {
                  "content": ""message 2 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 3,
                },
                {
                  "content": ""message 3 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 4,
                },
                {
                  "content": ""message 4 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 5,
                },
                {
                  "content": ""message 5 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 6,
                },
                {
                  "content": ""message 6 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 7,
                },
                {
                  "content": ""message 7 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 8,
                },
                {
                  "content": ""message 8 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 9,
                },
                {
                  "content": ""message 9 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 10,
                },
                {
                  "content": ""message 10 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 11,
                },
                {
                  "content": ""message 11 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 12,
                },
                {
                  "content": ""message 12 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 13,
                },
                {
                  "content": ""message 13 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 14,
                },
                {
                  "content": ""message 14 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 15,
                },
                {
                  "content": ""message 15 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 16,
                },
                {
                  "content": ""message 16 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 17,
                },
                {
                  "content": ""message 17 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 18,
                },
                {
                  "content": ""message 18 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 19,
                },
                {
                  "content": ""message 19 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 20,
                },
                {
                  "content": ""message 20 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 21,
                },
                {
                  "content": ""message 21 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 22,
                },
                {
                  "content": ""message 22 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 23,
                },
                {
                  "content": ""message 23 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 24,
                },
                {
                  "content": ""message 24 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 25,
                },
                {
                  "content": ""message 25 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 26,
                },
                {
                  "content": ""message 26 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 27,
                },
                {
                  "content": ""message 27 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 28,
                },
                {
                  "content": ""message 28 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 29,
                },
                {
                  "content": ""message 29 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 30,
                },
              ],
              "kind": "ok",
              "link": "[on b](omo-thread://v1/dur-on-b)",
              "source": "live_host",
              "thread": "dur-on-b",
              "truncated": false,
            },
            "here": {
              "items": [
                {
                  "content": ""message 0 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 1,
                },
                {
                  "content": ""message 1 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 2,
                },
                {
                  "content": ""message 2 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 3,
                },
                {
                  "content": ""message 3 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 4,
                },
                {
                  "content": ""message 4 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 5,
                },
                {
                  "content": ""message 5 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 6,
                },
                {
                  "content": ""message 6 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 7,
                },
                {
                  "content": ""message 7 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 8,
                },
                {
                  "content": ""message 8 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 9,
                },
                {
                  "content": ""message 9 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 10,
                },
                {
                  "content": ""message 10 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 11,
                },
                {
                  "content": ""message 11 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 12,
                },
                {
                  "content": ""message 12 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 13,
                },
                {
                  "content": ""message 13 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 14,
                },
                {
                  "content": ""message 14 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 15,
                },
                {
                  "content": ""message 15 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 16,
                },
                {
                  "content": ""message 16 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 17,
                },
                {
                  "content": ""message 17 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 18,
                },
                {
                  "content": ""message 18 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 19,
                },
                {
                  "content": ""message 19 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 20,
                },
                {
                  "content": ""message 20 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 21,
                },
                {
                  "content": ""message 21 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 22,
                },
                {
                  "content": ""message 22 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 23,
                },
                {
                  "content": ""message 23 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 24,
                },
                {
                  "content": ""message 24 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 25,
                },
                {
                  "content": ""message 25 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 26,
                },
                {
                  "content": ""message 26 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 27,
                },
                {
                  "content": ""message 27 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 28,
                },
                {
                  "content": ""message 28 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 29,
                },
                {
                  "content": ""message 29 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 30,
                },
              ],
              "kind": "ok",
              "link": "[local peer](omo-thread://v1/dur-local)",
              "source": "live_host",
              "thread": "dur-local",
              "truncated": false,
            },
          },
        },
        "wait": {
          "sdk": {
            "b": {
              "error": {
                "code": "invalid_arguments",
                "details": {
                  "unknown": [
                    "wait_ms",
                  ],
                },
                "message": "Unknown option: wait_ms.",
                "next_action": "Pass only thread, max_bytes, cursor, all_scope.",
              },
              "kind": "error",
            },
            "here": {
              "error": {
                "code": "invalid_arguments",
                "details": {
                  "unknown": [
                    "wait_ms",
                  ],
                },
                "message": "Unknown option: wait_ms.",
                "next_action": "Pass only thread, max_bytes, cursor, all_scope.",
              },
              "kind": "error",
            },
          },
          "tool": {
            "b": {
              "device": "b",
              "items": [
                {
                  "content": ""message 0 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 1,
                },
                {
                  "content": ""message 1 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 2,
                },
                {
                  "content": ""message 2 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 3,
                },
                {
                  "content": ""message 3 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 4,
                },
                {
                  "content": ""message 4 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 5,
                },
                {
                  "content": ""message 5 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 6,
                },
                {
                  "content": ""message 6 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 7,
                },
                {
                  "content": ""message 7 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 8,
                },
                {
                  "content": ""message 8 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 9,
                },
                {
                  "content": ""message 9 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 10,
                },
                {
                  "content": ""message 10 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 11,
                },
                {
                  "content": ""message 11 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 12,
                },
                {
                  "content": ""message 12 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 13,
                },
                {
                  "content": ""message 13 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 14,
                },
                {
                  "content": ""message 14 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 15,
                },
                {
                  "content": ""message 15 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 16,
                },
                {
                  "content": ""message 16 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 17,
                },
                {
                  "content": ""message 17 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 18,
                },
                {
                  "content": ""message 18 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 19,
                },
                {
                  "content": ""message 19 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 20,
                },
                {
                  "content": ""message 20 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 21,
                },
                {
                  "content": ""message 21 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 22,
                },
                {
                  "content": ""message 22 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 23,
                },
                {
                  "content": ""message 23 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 24,
                },
                {
                  "content": ""message 24 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 25,
                },
                {
                  "content": ""message 25 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 26,
                },
                {
                  "content": ""message 26 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 27,
                },
                {
                  "content": ""message 27 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 28,
                },
                {
                  "content": ""message 28 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 29,
                },
                {
                  "content": ""message 29 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 30,
                },
              ],
              "kind": "ok",
              "link": "[on b](omo-thread://v1/dur-on-b)",
              "source": "live_host",
              "thread": "dur-on-b",
              "truncated": false,
              "wait": {
                "outcome": "timeout",
                "status": "idle",
                "waited_ms": "<waited>",
              },
            },
            "here": {
              "items": [
                {
                  "content": ""message 0 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 1,
                },
                {
                  "content": ""message 1 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 2,
                },
                {
                  "content": ""message 2 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 3,
                },
                {
                  "content": ""message 3 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 4,
                },
                {
                  "content": ""message 4 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 5,
                },
                {
                  "content": ""message 5 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 6,
                },
                {
                  "content": ""message 6 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 7,
                },
                {
                  "content": ""message 7 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 8,
                },
                {
                  "content": ""message 8 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 9,
                },
                {
                  "content": ""message 9 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 10,
                },
                {
                  "content": ""message 10 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 11,
                },
                {
                  "content": ""message 11 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 12,
                },
                {
                  "content": ""message 12 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 13,
                },
                {
                  "content": ""message 13 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 14,
                },
                {
                  "content": ""message 14 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 15,
                },
                {
                  "content": ""message 15 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 16,
                },
                {
                  "content": ""message 16 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 17,
                },
                {
                  "content": ""message 17 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 18,
                },
                {
                  "content": ""message 18 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 19,
                },
                {
                  "content": ""message 19 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 20,
                },
                {
                  "content": ""message 20 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 21,
                },
                {
                  "content": ""message 21 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 22,
                },
                {
                  "content": ""message 22 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 23,
                },
                {
                  "content": ""message 23 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 24,
                },
                {
                  "content": ""message 24 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 25,
                },
                {
                  "content": ""message 25 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 26,
                },
                {
                  "content": ""message 26 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 27,
                },
                {
                  "content": ""message 27 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 28,
                },
                {
                  "content": ""message 28 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "user",
                  "seq": 29,
                },
                {
                  "content": ""message 29 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"",
                  "role": "assistant",
                  "seq": 30,
                },
              ],
              "kind": "ok",
              "link": "[local peer](omo-thread://v1/dur-local)",
              "source": "live_host",
              "thread": "dur-local",
              "truncated": false,
              "wait": {
                "outcome": "timeout",
                "status": "idle",
                "waited_ms": "<waited>",
              },
            },
          },
        },
      }
    `)
  })

  test("receipt: the outcome of the caller's own delivery, on the tool only; the SDK has no receipt read", async () => {
    const { s, sdk, tool } = fresh()
    const sent = (await s.run("thread_send", { thread: LEGS.here, message: "receipt me" })) as { delivery_id?: string }
    const deliveryId = String(sent.delivery_id)
    const pins = {
      own: await tool("thread_read", { thread: LEGS.here, delivery_id: deliveryId }),
      unknown: await tool("thread_read", { thread: LEGS.here, delivery_id: "dlv-nobody" }),
      sdk: stable(await sdk.read({ thread: LEGS.here, delivery_id: deliveryId } as never)),
      sdkMembers: ["receipt", "readAfterWait", "entries", "messages", "get", "wait"].filter((name) => name in sdk),
    }
    expect(pins).toMatchInlineSnapshot(`
      {
        "own": {
          "delivery_id": "<uuid>",
          "kind": "ok",
          "outcome": {
            "kind": "pending",
          },
          "thread": "dur-local",
        },
        "sdk": {
          "error": {
            "code": "invalid_arguments",
            "details": {
              "unknown": [
                "delivery_id",
              ],
            },
            "message": "Unknown option: delivery_id.",
            "next_action": "Pass only thread, max_bytes, cursor, all_scope.",
          },
          "kind": "error",
        },
        "sdkMembers": [],
        "unknown": {
          "delivery_id": "dlv-nobody",
          "kind": "ok",
          "outcome": {
            "kind": "outcome_unavailable",
          },
          "thread": "dur-local",
        },
      }
    `)
  })
})

describe("T1b pins: controls", () => {
  test("interrupt: both legs, both surfaces", async () => {
    const { sdk, tool } = fresh()
    expect(
      await table(["here", "b"], {
        tool: (thread) => tool("thread_interrupt", { thread }),
        sdk: (thread) => sdk.interrupt({ thread }),
      }),
    ).toMatchInlineSnapshot(`
      {
        "sdk": {
          "b": {
            "background": {
              "status": "not_supported",
            },
            "device": "b",
            "interrupted": false,
            "kind": "ok",
            "thread": "dur-on-b",
          },
          "here": {
            "background": {
              "status": "not_supported",
            },
            "interrupted": false,
            "kind": "ok",
            "thread": "dur-local",
          },
        },
        "tool": {
          "b": {
            "background": {
              "status": "not_supported",
            },
            "device": "b",
            "interrupted": false,
            "kind": "ok",
            "thread": "dur-on-b",
          },
          "here": {
            "background": {
              "status": "not_supported",
            },
            "interrupted": false,
            "kind": "ok",
            "thread": "dur-local",
          },
        },
      }
    `)
  })

  test("close: both legs, both surfaces, and `self`", async () => {
    const pins: Record<string, unknown> = {}
    for (const leg of ["here", "b"] as const) {
      const toolSide = fresh()
      const sdkSide = fresh()
      pins[leg] = {
        tool: await toolSide.tool("thread_close", { thread: LEGS[leg] }),
        sdk: stable(await sdkSide.sdk.close({ thread: LEGS[leg] })),
      }
    }
    const { sdk, tool } = fresh()
    pins["self"] = { tool: await tool("thread_close", {}), sdk: stable(await sdk.close({})) }
    expect(pins).toMatchInlineSnapshot(`
      {
        "b": {
          "sdk": {
            "closed": true,
            "device": "b",
            "dropped_deliveries": [],
            "kind": "ok",
            "reason": "closed",
            "thread": "dur-on-b",
          },
          "tool": {
            "closed": true,
            "device": "b",
            "dropped_deliveries": [],
            "kind": "ok",
            "reason": "closed",
            "thread": "dur-on-b",
          },
        },
        "here": {
          "sdk": {
            "closed": true,
            "dropped_deliveries": [],
            "kind": "ok",
            "reason": "closed",
            "thread": "dur-local",
          },
          "tool": {
            "closed": true,
            "dropped_deliveries": [],
            "kind": "ok",
            "reason": "closed",
            "thread": "dur-local",
          },
        },
        "self": {
          "sdk": {
            "error": {
              "code": "caller_context_missing",
              "kind": "error",
              "message": "The caller's durable session id is not in the thread address book.",
              "next_action": "Call thread_list (tool.thread_list() in an eval cell) and pass an explicit thread, or retry from a session with caller context.",
            },
            "kind": "error",
          },
          "tool": {
            "error": {
              "code": "caller_context_missing",
              "kind": "error",
              "message": "The caller's durable session id is not in the thread address book.",
              "next_action": "Call thread_list (tool.thread_list() in an eval cell) and pass an explicit thread, or retry from a session with caller context.",
            },
            "kind": "error",
          },
        },
      }
    `)
  })

  test("rename: both legs, both surfaces", async () => {
    const { sdk, tool } = fresh()
    expect(
      await table(["here", "b"], {
        tool: (thread) => tool("thread_rename", { thread, name: `tool ${thread}` }),
        sdk: (thread) => sdk.rename({ thread, name: `sdk ${thread}` }),
      }),
    ).toMatchInlineSnapshot(`
      {
        "sdk": {
          "b": {
            "device": "b",
            "kind": "ok",
            "name": "sdk dur-on-b",
            "thread": "dur-on-b",
          },
          "here": {
            "kind": "ok",
            "name": "sdk dur-local",
            "thread": "dur-local",
          },
        },
        "tool": {
          "b": {
            "device": "b",
            "kind": "ok",
            "name": "tool dur-on-b",
            "thread": "dur-on-b",
          },
          "here": {
            "kind": "ok",
            "name": "tool dur-local",
            "thread": "dur-local",
          },
        },
      }
    `)
  })

  test("set reasoning and archive: tool only; the SDK has neither call", async () => {
    const { sdk, tool } = fresh()
    const pins = {
      reasoning: await table(["here", "b"], {
        tool: (thread) => tool("thread_set_reasoning", { thread, level: "low" }),
      }),
      archive: await table(["here", "b"], {
        tool: (thread) => tool("thread_archive", { thread }),
      }),
      sdkMembers: ["setReasoning", "set_reasoning", "archive", "unload"].filter((name) => name in sdk),
    }
    expect(pins).toMatchInlineSnapshot(`
      {
        "archive": {
          "tool": {
            "b": {
              "archived": true,
              "created_at": "<time>",
              "cwd": "/work/b",
              "device": "b",
              "kind": "ok",
              "link": "[on b](omo-thread://v1/dur-on-b)",
              "name": "on b",
              "state": "archived",
              "status": "live",
              "thread": "dur-on-b",
              "updated_at": "<time>",
            },
            "here": {
              "archived": true,
              "created_at": "<time>",
              "cwd": "<cwd>",
              "kind": "ok",
              "link": "[local peer](omo-thread://v1/dur-local)",
              "name": "local peer",
              "state": "archived",
              "status": "live",
              "thread": "dur-local",
              "updated_at": "<time>",
            },
          },
        },
        "reasoning": {
          "tool": {
            "b": {
              "device": "b",
              "kind": "ok",
              "level": "low",
              "scope": "session",
              "thread": "dur-on-b",
            },
            "here": {
              "kind": "ok",
              "level": "low",
              "scope": "session",
              "thread": "dur-local",
            },
          },
        },
        "sdkMembers": [],
      }
    `)
  })
})

describe("T1b pins: the idempotency key on a control call", () => {
  test("a repeat of close under one key: the tool and the SDK replay the first answer and close once", async () => {
    const toolSide = fresh()
    const first = await toolSide.tool("thread_close", { thread: LEGS.here, idempotency_key: "k-close" })
    const again = await toolSide.tool("thread_close", { thread: LEGS.here, idempotency_key: "k-close" })
    const sdkSide = fresh()
    const sdkFirst = stable(await sdkSide.sdk.close({ thread: LEGS.here, idempotency_key: "k-close" }))
    const sdkAgain = stable(await sdkSide.sdk.close({ thread: LEGS.here, idempotency_key: "k-close" }))
    expect({
      tool: { first, again, closes: toolSide.s.closed.length },
      sdk: { first: sdkFirst, again: sdkAgain, closes: sdkSide.s.closed.length },
    }).toMatchInlineSnapshot(`
      {
        "sdk": {
          "again": {
            "closed": true,
            "dropped_deliveries": [],
            "kind": "ok",
            "reason": "closed",
            "thread": "dur-local",
          },
          "closes": 1,
          "first": {
            "closed": true,
            "dropped_deliveries": [],
            "kind": "ok",
            "reason": "closed",
            "thread": "dur-local",
          },
        },
        "tool": {
          "again": {
            "closed": true,
            "dropped_deliveries": [],
            "kind": "ok",
            "reason": "closed",
            "thread": "dur-local",
          },
          "closes": 1,
          "first": {
            "closed": true,
            "dropped_deliveries": [],
            "kind": "ok",
            "reason": "closed",
            "thread": "dur-local",
          },
        },
      }
    `)
  })

  test("a repeat of interrupt under one key on device b: how many interrupts reach b's engine", async () => {
    const toolSide = fresh()
    await toolSide.tool("thread_interrupt", { thread: LEGS.b, idempotency_key: "k-int" })
    await toolSide.tool("thread_interrupt", { thread: LEGS.b, idempotency_key: "k-int" })
    const sdkSide = fresh()
    await sdkSide.sdk.interrupt({ thread: LEGS.b, idempotency_key: "k-int" })
    await sdkSide.sdk.interrupt({ thread: LEGS.b, idempotency_key: "k-int" })
    const interruptsOn = (sent: readonly { rpc?: Record<string, unknown> }[]) =>
      sent.filter((entry) => entry.rpc?.["type"] === "interrupt").length
    expect({ tool: interruptsOn(toolSide.a.sent), sdk: interruptsOn(sdkSide.a.sent) }).toMatchInlineSnapshot(`
      {
        "sdk": 1,
        "tool": 1,
      }
    `)
  })
})

describe("T1b pins: send and create inputs", () => {
  test("send: the tool's names (message, delivery, summary) against the SDK's (text, mode)", async () => {
    const { sdk, tool } = fresh()
    const pins = {
      plain: await table(["here", "b"], {
        tool: (thread) => tool("thread_send", { thread, message: "hello" }),
        sdk: (thread) => sdk.send({ thread, text: "hello" }),
      }),
      summary: {
        tool: await tool("thread_send", { thread: LEGS.here, message: "with summary", summary: "s" }),
        sdk: stable(await sdk.send({ thread: LEGS.here, text: "with summary", summary: "s" } as never)),
      },
      toolNames: stable(await sdk.send({ thread: LEGS.here, message: "tool names" } as never)),
    }
    expect(pins).toMatchInlineSnapshot(`
      {
        "plain": {
          "sdk": {
            "b": {
              "deduplicated": false,
              "delivery": {
                "kind": "started",
                "turn_id": "turn-b",
              },
              "device": "b",
              "effective_mode": "start",
              "kind": "ok",
              "thread": "dur-on-b",
            },
            "here": {
              "deduplicated": false,
              "delivery": {
                "kind": "queued_offline",
                "queue_position": 2,
              },
              "delivery_id": "<uuid>",
              "effective_mode": "auto",
              "endpoint_kind": "rpc_host",
              "kind": "ok",
              "message_seq": 2,
              "thread": "dur-local",
            },
          },
          "tool": {
            "b": {
              "deduplicated": false,
              "delivery": {
                "kind": "started",
                "turn_id": "turn-b",
              },
              "delivery_id": "<uuid>",
              "device": "b",
              "effective_mode": "start",
              "kind": "ok",
              "link": "[on b](omo-thread://v1/dur-on-b)",
              "thread": "dur-on-b",
            },
            "here": {
              "deduplicated": false,
              "delivery": {
                "kind": "queued_offline",
                "queue_position": 1,
              },
              "delivery_id": "<uuid>",
              "effective_mode": "auto",
              "kind": "ok",
              "link": "[local peer](omo-thread://v1/dur-local)",
              "message_seq": 1,
              "thread": "dur-local",
            },
          },
        },
        "summary": {
          "sdk": {
            "error": {
              "code": "invalid_arguments",
              "details": {
                "unknown": [
                  "summary",
                ],
              },
              "message": "Unknown option: summary.",
              "next_action": "Pass only thread, text, mode, expected_turn_id, all_scope, idempotency_key, collapse_key.",
            },
            "kind": "error",
          },
          "tool": {
            "deduplicated": false,
            "delivery": {
              "kind": "queued_offline",
              "queue_position": 3,
            },
            "delivery_id": "<uuid>",
            "effective_mode": "auto",
            "kind": "ok",
            "link": "[local peer](omo-thread://v1/dur-local)",
            "message_seq": 3,
            "thread": "dur-local",
          },
        },
        "toolNames": {
          "error": {
            "code": "invalid_arguments",
            "details": {
              "unknown": [
                "message",
              ],
            },
            "message": "Unknown option: message.",
            "next_action": "Pass only thread, text, mode, expected_turn_id, all_scope, idempotency_key, collapse_key.",
          },
          "kind": "error",
        },
      }
    `)
  })

  test("create: a new thread on this device and on b, through both surfaces", async () => {
    const pins: Record<string, unknown> = {}
    for (const device of [undefined, "b"] as const) {
      const toolSide = fresh()
      const sdkSide = fresh()
      const args = { name: "pinned new", ...(device === undefined ? {} : { device }) }
      pins[device === undefined ? "here" : "b"] = {
        tool: await toolSide.tool("thread_create", args),
        sdk: stable(await sdkSide.sdk.create(args)),
      }
    }
    expect(pins).toMatchInlineSnapshot(`
      {
        "b": {
          "sdk": {
            "created_at": "<time>",
            "cwd": "",
            "deduplicated": false,
            "device": "b",
            "kind": "ok",
            "link": "[pinned new](omo-thread://v1/dur-new-on-b)",
            "name": "pinned new",
            "prompt": null,
            "state": "idle",
            "status": "live",
            "thread": "dur-new-on-b",
            "updated_at": "<time>",
          },
          "tool": {
            "created_at": "<time>",
            "cwd": "",
            "deduplicated": false,
            "device": "b",
            "kind": "ok",
            "link": "[pinned new](omo-thread://v1/dur-new-on-b)",
            "name": "pinned new",
            "prompt": null,
            "state": "idle",
            "status": "live",
            "thread": "dur-new-on-b",
            "updated_at": "<time>",
          },
        },
        "here": {
          "sdk": {
            "created_at": "<time>",
            "cwd": "<cwd>",
            "deduplicated": false,
            "kind": "ok",
            "link": "[thread](omo-thread://v1/dur-created-here)",
            "name": "",
            "prompt": null,
            "state": "idle",
            "status": "live",
            "thread": "dur-created-here",
            "updated_at": "<time>",
          },
          "tool": {
            "created_at": "<time>",
            "cwd": "<cwd>",
            "deduplicated": false,
            "kind": "ok",
            "link": "[thread](omo-thread://v1/dur-created-here)",
            "name": "",
            "prompt": null,
            "state": "idle",
            "status": "live",
            "thread": "dur-created-here",
            "updated_at": "<time>",
          },
        },
      }
    `)
  })
})
