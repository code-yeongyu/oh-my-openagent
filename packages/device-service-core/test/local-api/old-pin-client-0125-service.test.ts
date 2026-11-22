import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { validateResponse, validateWelcome } from "../../vendor/omo-5.1.66-decoder/validate.ts"

// #12981 review, #914(a): an omo through 5.1.66 pins device service 0.1.3 but keeps any running service at or above its
// pin (bootstrap.ts), so it talks to a 0.1.25 service that a newer omo installed. Its local API decoders refuse every
// field they do not know; this tree's decoders ignore unknown reply fields since #914, so the test reads the frames with
// the v5.1.66 decoders vendored in vendor/omo-5.1.66-decoder (pinned in old-pin-client-0127-service.test.ts). The fixture holds the frames a 0.1.25 local API server wrote to an omo 5.1.66 hello
// whose session.endpoints request did not ask for environments (relayd #915 sends them only when negotiated).
type Recording = {
  readonly client_frames: readonly unknown[]
  readonly service_frames: readonly unknown[]
}
const recording: Recording = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "device-service-0.1.25-omo-5.1.66-session-endpoints.json"), "utf8"),
)

describe("an omo through 5.1.66 (pin 0.1.3) talking to a running 0.1.25 service", () => {
  test("decodes the 0.1.25 welcome, authenticate and session.endpoints replies to its un-negotiated request", () => {
    // given the frames 0.1.25 answered to a 5.1.66 client whose session.endpoints request named only the device
    const [welcome, authenticated, endpoints] = recording.service_frames
    expect(recording.client_frames.at(-1)).toEqual({ id: "2", type: "session.endpoints", device: "dev-a" })

    // when the client's strict decoders read them
    // then each one decodes, and session.endpoints carries exactly the endpoints the peer listed
    expect(validateWelcome(welcome)).toMatchObject({ type: "welcome", service_version: "0.1.25" })
    expect(validateResponse(authenticated, "authenticate")).toEqual({ id: "1", ok: true, data: {} })
    expect(validateResponse(endpoints, "session.endpoints")).toEqual({
      id: "2",
      ok: true,
      data: { endpoints: ["RVBFUEVQRVBFUEVQRVBFUA"] },
    })
  })
})
