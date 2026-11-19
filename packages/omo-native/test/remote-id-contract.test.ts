import { describe, expect, test } from "bun:test"
import { existsSync, watch } from "node:fs"
import { basename, dirname } from "node:path"
import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld, PEER, SESSION_ID } from "../../device-service-core/test/local-api/conformance/world.ts"
import { prepareRemoteAttach, REMOTE_EXIT } from "../remote-cli"
import { owners, privateDir, run, SIGNED_IN, useRemoteCliCleanup } from "./remote-cli-harness"

useRemoteCliCleanup()

const DURABLE = "durable-session-42"
const MODEL = { provider: "test", id: "model" }

async function owner(duplicate = false) {
  const world = defaultWorld()
  const session = world.sessions[0]
  const row = world.listing.revisions.at(-1)?.rows.find((item) => item.device === PEER)
  if (session === undefined || row === undefined) throw new Error("missing conformance session")
  const applied = [{ state: "engine_applied", retryable: false }] as const
  const fake = await startFakeOwner({
    stateDir: privateDir(),
    world: {
      ...world,
      // The conformance owner implements locate, but not the newer single-probe request field.
      service_version: "0.1.12",
      devices: world.devices.filter((device) => device.device === PEER),
      listing: {
        revisions: [
          {
            rows: [
              { ...row, durable_id: DURABLE },
              ...(duplicate ? [{ ...row, device: "another-device", durable_id: DURABLE }] : []),
            ],
            incomplete: [],
          },
        ],
        devices: { [PEER]: "answered" },
      },
      endpoints: { [PEER]: [SESSION_ID] },
      primary: { [PEER]: SESSION_ID },
      located: { [PEER]: { [DURABLE]: SESSION_ID } },
      endpointCommand: { data: { state: { durableSessionId: DURABLE } }, outcome: applied },
      sessions: [
        {
          ...session,
          records: [],
          outcome: applied,
          delegated: {
            data: {
              models: [MODEL],
              ...MODEL,
              isStreaming: false,
              disposition: "started",
              turnId: "turn-42",
              outcome: "unloaded",
              sessionPath: "/work/session.jsonl",
            },
            frames: [],
          },
        },
      ],
    },
  })
  owners.push(fake)
  return fake
}

describe("#13010 remote CLI session identity", () => {
  // #13409: the model rides on the one open_session (the engine's launch profile), so no later model step can miss the
  // session whose durable id differs from its attach key.
  test("open --model succeeds when its durable ID differs from its attach key", async () => {
    const fake = await owner()
    const result = await run(["open", PEER, "--model", "test/model", "--json"], fake.stateDir)
    expect({ code: result.code, json: JSON.parse(result.out.join("")) }).toMatchObject({
      code: REMOTE_EXIT.ok,
      json: { kind: "ok", thread: DURABLE, model: MODEL },
    })
    expect(JSON.stringify(fake.state.commands)).not.toContain("set_model")
  })

  test.each([
    ["missing-session", false, "not_found"],
    [DURABLE, true, "ambiguous_target"],
  ] as const)("refuses %s without sending a command when resolution answers %s", async (target, duplicate, error) => {
    const fake = await owner(duplicate)
    const result = await run(["interrupt", target, "--json"], fake.stateDir)
    expect({ code: result.code, json: JSON.parse(result.out.join("")), commands: fake.state.commands }).toMatchObject({
      code: REMOTE_EXIT.failed,
      json: { kind: "error", error: { code: error } },
      commands: [],
    })
  })

  test.each([
    ["send", ["hello", "--no-wait"]],
    ["model", ["test/model"]],
    ["interrupt", []],
    ["close", []],
  ] as const)("%s accepts the durable ID and both device-prefixed ID forms", async (verb, tail) => {
    const fake = await owner()
    for (const target of [DURABLE, `${PEER}/${DURABLE}`, `${PEER}/${SESSION_ID}`]) {
      const result = await run([verb, target, ...tail, "--json"], fake.stateDir)
      expect({ target, code: result.code, json: result.out.map((line) => JSON.parse(line)) }).toMatchObject({
        target,
        code: REMOTE_EXIT.ok,
        json: [{ kind: "ok", thread: target === `${PEER}/${SESSION_ID}` ? SESSION_ID : DURABLE }],
      })
    }
  })

  test("attach accepts the durable ID and both device-prefixed ID forms", async () => {
    const fake = await owner()
    for (const target of [DURABLE, `${PEER}/${DURABLE}`, `${PEER}/${SESSION_ID}`]) {
      const service = await connectDeviceService({ version: "5.1.72", stateDir: fake.stateDir })
      const prepared = await prepareRemoteAttach(
        {
          accountShow: async () => SIGNED_IN,
          stateDir: fake.stateDir,
          connect: async () => service,
          now: () => 0,
          output: () => {},
          write: () => {},
          error: () => {},
        },
        [target],
      )
      try {
        expect(typeof prepared).toBe("object")
        if (typeof prepared === "number") return
        // The attach port only borrowed the CLI's own connection (#13761): it still answers.
        expect((await service.status()).state).toBe("connected")
        const socket = prepared.engineArgs[1]
        if (socket === undefined) throw new Error("attach did not name its endpoint")
        const endpoint = dirname(socket)
        // Closing the service schedules the endpoint's asynchronous server.close; wait for that endpoint's removal.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            watcher.close()
            reject(new Error("attach endpoint was not removed"))
          }, 2_000)
          const watcher = watch(dirname(endpoint), (_event, name) => {
            if (name !== basename(endpoint) || existsSync(endpoint)) return
            watcher.close()
            clearTimeout(timer)
            resolve()
          })
          service.close()
        })
      } finally {
        service.close()
      }
    }
  })
})
