import { afterEach, describe, expect, test } from "bun:test"

import type { JsonObject } from "../../../../device-service-core/src/local-api/protocol.ts"
import {
  defaultWorld,
  PEER,
  SESSION_ID,
  type World,
} from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { handleOf } from "./seams"
import { clientOn, closeClients, fakeClock, startOwner } from "./testing/fake-service"

// Slice T1b (#14951), deliverable 1: what the remote module's session members answer TODAY for the calls T1b moves into
// the thread core, on a session another device holds, over the device service's conformance owner; and what the owner
// received. Written on unmodified code and left unmodified while the bodies move (tool, SDK and CLI pins are in
// thread/t1b-surface-pins.test.ts and omo-native thread-cli-pins.test.ts).

afterEach(closeClients)

const REPLY: JsonObject = {
  isStreaming: false,
  currentTurnId: "7",
  pendingMessageCount: 0,
  pendingDialogs: [],
  model: { provider: "anthropic", id: "claude" },
  thinkingLevel: "high",
  permissionPreset: "workspace",
  cwd: "/work",
  turnId: "7",
  interrupted: true,
  outcome: "unloaded",
}

const world = (): World => {
  const base = defaultWorld()
  const live = base.sessions[0]
  if (live === undefined) throw new Error("the default world holds a live session")
  return { ...base, sessions: [{ ...live, delegated: { data: REPLY, frames: [] } }] }
}

const LIVE = handleOf(PEER, SESSION_ID)

async function onWorld() {
  const owner = await startOwner(world())
  const client = clientOn(owner.stateDir, fakeClock())
  const sent = () => owner.state.commands.map((rpc) => rpc["type"])
  return { client, sent }
}

describe("T1b pins: the remote module's session members", () => {
  test("get, read, interrupt, setReasoning, archive, close on device b, and the records the owner received", async () => {
    const { client, sent } = await onWorld()
    const pins = {
      get: await client.sessions.get(LIVE),
      read: await client.sessions.read(LIVE, { tail: 2 }),
      interrupt: await client.sessions.interrupt(LIVE),
      setReasoning: await client.sessions.setReasoning(LIVE, "low"),
      archive: await client.sessions.archive(LIVE, true),
      close: await client.sessions.close(LIVE),
      records: sent(),
    }
    expect(pins).toMatchInlineSnapshot(`
      {
        "archive": {
          "kind": "ok",
          "value": {
            "archived": true,
          },
        },
        "close": {
          "kind": "ok",
          "value": {
            "closed": true,
            "dropped_deliveries": [],
          },
        },
        "get": {
          "kind": "ok",
          "value": {
            "archived": false,
            "cwd": "/work",
            "device": {
              "caps": {
                "attach": true,
                "control": false,
                "machine": false,
              },
              "id": "dev-peer-1",
              "kind": "desktop",
              "last_seen_ms": 1790000000000,
              "name": "Studio",
              "online": true,
              "platform": "darwin",
            },
            "model": "anthropic/claude",
            "name": "Live session",
            "path": "/home/user/omo",
            "pending": {
              "dialogs": 0,
              "queued": 0,
            },
            "preset": "workspace",
            "project": "omo",
            "reasoning": "high",
            "source": "live",
            "state": "running",
            "thread": "dev-peer-1/c2Vzc2lvbi1rZXktMDAwMQ",
            "title": "Live session",
            "turn": {
              "id": "7",
              "state": "idle",
            },
            "updated_ms": 1790000000000,
          },
        },
        "interrupt": {
          "kind": "ok",
          "value": {
            "background": {
              "status": "not_supported",
            },
            "device": "dev-peer-1",
            "interrupted": true,
            "thread": "dev-peer-1/c2Vzc2lvbi1rZXktMDAwMQ",
            "turn_id": "7",
          },
        },
        "read": {
          "kind": "ok",
          "value": {
            "entries": [],
            "next_before": null,
          },
        },
        "records": [
          "get_state",
          "interrupt",
          "set_thinking_level",
          "set_session_archived",
          "unload_session",
        ],
        "setReasoning": {
          "kind": "ok",
          "value": {
            "reasoning": "low",
          },
        },
      }
    `)
  })

  test("#given an engine that reports the interrupted turn's background jobs #when sessions.interrupt runs #then it asks the engine to stop them and answers the jobs, as interruptThread does on every leg", async () => {
    const base = world()
    const live = base.sessions[0]
    if (live === undefined) throw new Error("the default world holds a live session")
    const background = { stopped: [{ kind: "bash", id: "bash_1", description: "sleep 60" }], failed: [] }
    const owner = await startOwner({
      ...base,
      sessions: [{ ...live, delegated: { data: { ...REPLY, background }, frames: [] } }],
    })
    const client = clientOn(owner.stateDir, fakeClock())
    const answer = await client.sessions.interrupt(LIVE)
    expect(owner.state.commands.filter((rpc) => rpc["type"] === "interrupt")).toEqual([
      expect.objectContaining({ background: "stop" }),
    ])
    expect(answer).toMatchObject({ kind: "ok", value: { background: { status: "stopped", ...background } } })
  })

  test("interrupt twice: the remote module takes no idempotency key, so each call reaches the engine", async () => {
    const { client, sent } = await onWorld()
    await client.sessions.interrupt(LIVE)
    await client.sessions.interrupt(LIVE)
    expect(sent().filter((type) => type === "interrupt").length).toMatchInlineSnapshot(`2`)
  })
})
