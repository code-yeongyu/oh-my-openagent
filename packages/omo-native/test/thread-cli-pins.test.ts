import { afterEach, describe, expect, test } from "bun:test"

import { createRemoteThreadFixture } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import { runThreadCommand } from "../bin/lib/thread.js"

/**
 * Slice T1b (#14951), deliverable 1: what `omo thread <verb> --json` prints and exits with TODAY, over the plugin's real
 * thread SDK on one scripted holder, for a thread on this device (`dur-local`) and one on device b (`dur-on-b`). Written
 * on unmodified code and left unmodified while the bodies move into the thread core (the tool and SDK pins are
 * omo-senpi `t1b-surface-pins.test.ts`).
 */

const fixture = createRemoteThreadFixture()
afterEach(fixture.cleanup)

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g

function capture() {
  const chunks: string[] = []
  return { write: (text: string) => void chunks.push(text), text: () => chunks.join("") }
}

function cli() {
  const a = fixture.account()
  const s = fixture.surface(a.remote)
  const sdk = s.sdk()
  const run = async (args: readonly string[]) => {
    const stdout = capture()
    const stderr = capture()
    const exit = await runThreadCommand([...args, "--json"], {
      engine: { run: () => ({ exitCode: 0, stdout: "", stderr: "" }) },
      pluginRoot: "/plugin",
      agentDir: s.agentDir,
      env: {},
      cwd: process.cwd(),
      stdout,
      stderr,
      platform: "linux",
      loadSqlite: async () => ({}),
      importSdk: async () => ({ createThreadSdk: () => ({ ...sdk, dispose: async () => {} }) }),
      identity: { uid: 501, user: "qa" },
    }).catch((error: unknown) => ({
      threw: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }))
    const printed = stdout.text().split(process.cwd()).join("<cwd>").replace(UUID, "<uuid>").replace(ISO, "<time>")
    return { exit, json: printed === "" ? null : (JSON.parse(printed) as unknown) }
  }
  return { a, s, run }
}

describe("omo thread pins", () => {
  test("list, read (plain and --limit 1), send, close on each leg", async () => {
    const pins: Record<string, unknown> = {}
    for (const [leg, thread] of [
      ["here", "dur-local"],
      ["b", "dur-on-b"],
    ] as const) {
      const { run } = cli()
      pins[leg] = {
        read: await run(["read", thread]),
        readLimit: await run(["read", thread, "--limit", "1"]),
        send: await run(["send", thread, "hello"]),
        close: await run(["close", thread]),
      }
    }
    pins["list"] = await cli().run(["list"])
    expect(pins).toMatchInlineSnapshot(`
      {
        "b": {
          "close": {
            "exit": 0,
            "json": {
              "closed": true,
              "device": "b",
              "dropped_deliveries": [],
              "kind": "ok",
              "reason": "closed",
              "thread": "dur-on-b",
            },
          },
          "read": {
            "exit": 0,
            "json": {
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
          },
          "readLimit": {
            "exit": 0,
            "json": {
              "device": "b",
              "items": [
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
          },
          "send": {
            "exit": 0,
            "json": {
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
          },
        },
        "here": {
          "close": {
            "exit": 0,
            "json": {
              "closed": true,
              "dropped_deliveries": [],
              "kind": "ok",
              "reason": "closed",
              "thread": "dur-local",
            },
          },
          "read": {
            "exit": 0,
            "json": {
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
          "readLimit": {
            "exit": 0,
            "json": {
              "items": [
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
          "send": {
            "exit": 0,
            "json": {
              "deduplicated": false,
              "delivery": {
                "kind": "queued_offline",
                "queue_position": 1,
              },
              "delivery_id": "<uuid>",
              "effective_mode": "auto",
              "endpoint_kind": "rpc_host",
              "kind": "ok",
              "message_seq": 1,
              "thread": "dur-local",
            },
          },
        },
        "list": {
          "exit": 0,
          "json": {
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

  test("close twice under one --idempotency-key: what each run prints and how many closes reach the holder", async () => {
    const { s, run } = cli()
    const first = await run(["close", "dur-local", "--idempotency-key", "k-cli"])
    const again = await run(["close", "dur-local", "--idempotency-key", "k-cli"])
    expect({ first, again, closes: s.closed.length }).toMatchInlineSnapshot(`
      {
        "again": {
          "exit": 0,
          "json": {
            "closed": true,
            "dropped_deliveries": [],
            "kind": "ok",
            "reason": "closed",
            "thread": "dur-local",
          },
        },
        "closes": 1,
        "first": {
          "exit": 0,
          "json": {
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
})
