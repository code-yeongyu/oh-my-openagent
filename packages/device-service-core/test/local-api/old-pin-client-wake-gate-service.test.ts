import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { validateEvent, validateResponse, validateWelcome } from "../../vendor/omo-5.1.66-decoder/validate.ts"

// omo#13037 A6 addendum 3 (A6PR-1): the local signal for the wake mark is welcome.service_version and nothing else, so a
// device service at the gate version adds no welcome field, no capability word and no interface version. An omo through
// 5.1.66, whose decoders refuse every field they do not know, must therefore read that service exactly as it reads one
// before it. The welcome below is the recorded 0.1.27 one with only its version raised to the gate's test value; the
// answers are the ones the wake path adds, in the shapes this tree already decodes.

type Frames = { readonly service_frames: readonly unknown[] }
const served: Frames = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "device-service-0.1.27-omo-5.1.66-session-endpoints.json"), "utf8"),
)
const GATE_TEST_VERSION = "0.1.31"
const recordedWelcome = served.service_frames[0] as Readonly<Record<string, unknown>>
const gateWelcome = { ...recordedWelcome, service_version: GATE_TEST_VERSION }

describe("an omo through 5.1.66 talking to a device service at the wake gate's version", () => {
  test("decodes the welcome, which differs from the recorded one only in its version", () => {
    expect(Object.keys(gateWelcome).sort()).toEqual(Object.keys(recordedWelcome).sort())
    expect(validateWelcome(gateWelcome)).toMatchObject({
      type: "welcome",
      service_version: GATE_TEST_VERSION,
      capabilities: (recordedWelcome as { readonly capabilities: unknown }).capabilities,
    })
  })

  test("decodes the answers the wake path adds: a located ended session, a command id, and a refusal with its receipt", () => {
    expect(
      validateResponse(
        {
          id: "3",
          type: "response",
          ok: true,
          data: { device: "dev-a", key: "S0VZS0VZS0VZS0VZS0VZSw", session: "dev-a.S0VZS0VZS0VZS0VZS0VZSw" },
        },
        "session.locate",
      ),
    ).toMatchObject({ ok: true, data: { key: "S0VZS0VZS0VZS0VZS0VZSw" } })
    expect(
      validateResponse(
        { id: "4", type: "response", ok: true, data: { command_id: "Y29tbWFuZC1pZC0wMDAwMQ" } },
        "session.command",
      ),
    ).toMatchObject({ ok: true, data: { command_id: "Y29tbWFuZC1pZC0wMDAwMQ" } })
    expect(
      validateEvent({
        type: "event",
        kind: "session.command_state",
        command_id: "Y29tbWFuZC1pZC0wMDAwMQ",
        state: "engine_refused",
        reason: "engine_capability_missing",
        retryable: false,
        receipt: { reason: "wake_unavailable" },
      }),
    ).toMatchObject({ kind: "session.command_state", state: "engine_refused", receipt: { reason: "wake_unavailable" } })
  })
})
