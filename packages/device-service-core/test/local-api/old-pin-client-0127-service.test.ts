import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { validateResponse, validateWelcome } from "../../vendor/omo-5.1.66-decoder/validate.ts"

// #12981 review: the pin is 0.1.27, so an omo through 5.1.66 (pin 0.1.3; it keeps any running service at or above its
// pin, bootstrap.ts) talks to a 0.1.27 service that a newer omo installed. Its local API decoders refuse every field
// they do not know. This tree's decoders ignore unknown reply fields since #914, so the old ones are vendored byte for
// byte from v5.1.66 (vendor/omo-5.1.66-decoder, pinned below; v5.1.65 has the same blobs, and no release tag carries
// the lenient ones). Two recordings:
// - device-service-0.1.27-omo-5.1.66-session-endpoints.json: the 0.1.27 local API server, recorded exactly as the 0.1.25
//   fixture was, for a 5.1.66 hello whose session.endpoints request did not ask for environments, and for a 5.1.67 hello.
//   Against the 0.1.25 recording only service_version, nonces and proofs differ: same welcome fields, capabilities and
//   state, the same authenticate reply, and the same endpoints-only reply.
// - device-service-0.1.27-signed-binary-omo-5.1.66-handshake.json: the signed 0.1.27 linux-x64 binary, never adopted.
//   Its welcome lists "machine" beyond the recorder's five capabilities (an optional capability 5.1.66 accepts), its
//   state is not_configured with no device, and session.endpoints answers signed_out.
type Frames = { readonly client_frames: readonly unknown[]; readonly service_frames: readonly unknown[] }
const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", name), "utf8"))
const served = fixture<Frames & { readonly current_hello: Frames }>(
  "device-service-0.1.27-omo-5.1.66-session-endpoints.json",
)
const signed = fixture<Frames>("device-service-0.1.27-signed-binary-omo-5.1.66-handshake.json")

describe("an omo through 5.1.66 (pin 0.1.3) talking to a running 0.1.27 service", () => {
  test("decodes the 0.1.27 welcome, authenticate and session.endpoints replies to its un-negotiated request", () => {
    // given the frames 0.1.27 answered to a 5.1.66 client whose session.endpoints request named only the device
    const [welcome, authenticated, endpoints] = served.service_frames
    expect(served.client_frames.at(-1)).toEqual({ id: "2", type: "session.endpoints", device: "dev-a" })

    // when the 5.1.66 decoders read them
    // then each one decodes, and session.endpoints carries exactly the endpoints the peer listed
    expect(validateWelcome(welcome)).toMatchObject({ type: "welcome", service_version: "0.1.27" })
    expect(validateResponse(authenticated, "authenticate")).toEqual({ id: "1", ok: true, data: {} })
    expect(validateResponse(endpoints, "session.endpoints")).toEqual({
      id: "2",
      ok: true,
      data: { endpoints: ["RVBFUEVQRVBFUEVQRVBFUA"] },
    })
  })

  test("decodes the signed 0.1.27 binary's welcome, authenticate and signed_out answer", () => {
    // given the frames the signed binary wrote to a 5.1.66 client before any adoption
    const [welcome, authenticated, endpoints] = signed.service_frames

    // when the 5.1.66 decoders read them
    // then the welcome decodes with the service's own capabilities and state, and the refusal stays typed
    expect(validateWelcome(welcome)).toMatchObject({
      service_version: "0.1.27",
      capabilities: ["sessions", "devices", "enforcement", "upgrade", "control", "machine"],
      state: { state: "not_configured", device: null, origin_configured: false, enabled: true },
    })
    expect(validateResponse(authenticated, "authenticate")).toEqual({ id: "1", ok: true, data: {} })
    expect(validateResponse(endpoints, "session.endpoints")).toMatchObject({
      ok: false,
      error: { code: "signed_out" },
    })
  })

  test("control: the 0.1.27 reply to a 5.1.67 hello carries environments, which the 5.1.66 decoder refuses", () => {
    // given the session.endpoints reply 0.1.27 wrote to a client new enough to be sent environments
    const endpoints = served.current_hello.service_frames[2]
    expect(endpoints).toMatchObject({ data: { environments: ["RU5WRU5WRU5WRU5WRU5WRQ"] } })

    // when the 5.1.66 decoder reads it
    // then it is a protocol violation, so the un-negotiated case above is what keeps old clients working
    expect(() => validateResponse(endpoints, "session.endpoints")).toThrow("data has an unknown field")
  })
})

describe("the vendored omo 5.1.66 decoder", () => {
  test("is byte for byte the v5.1.66 tree", () => {
    // given the git blob ids of packages/device-service-core/src/local-api at v5.1.66
    const dir = join(import.meta.dir, "..", "..", "vendor", "omo-5.1.66-decoder")
    const pin: { readonly blobs: Readonly<Record<string, string>> } = JSON.parse(
      readFileSync(join(dir, "PIN.json"), "utf8"),
    )

    // when each vendored file is hashed as a git blob
    const blob = (bytes: Buffer): string =>
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")

    // then every one matches its pinned id
    for (const [name, id] of Object.entries(pin.blobs))
      expect([name, blob(readFileSync(join(dir, name)))]).toEqual([name, id])
  })
})
