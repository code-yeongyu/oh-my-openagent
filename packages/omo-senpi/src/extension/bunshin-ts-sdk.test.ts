import { describe, expect, it } from "bun:test"

import {
  bunshin,
  BunshinSessionError,
  connect,
  createRelayTransport,
  FanoutRun,
  pickTransport,
  relayStatus,
  RelayTransportError,
  SDK_VERSION,
} from "./bunshin-ts-sdk"

// Public API contract: eval cells destructure these names from `${OMO_BUNSHIN_TS_SDK_ROOT}/sdk.js`.
describe("bunshin-ts eval SDK entry", () => {
  it("#given the SDK entry #when a cell destructures the documented names #then each is the live value, and the transport pick runs through it", async () => {
    for (const value of [
      connect,
      createRelayTransport,
      relayStatus,
      pickTransport,
      bunshin.listMachines,
      bunshin.fanout,
    ]) {
      expect(typeof value).toBe("function")
    }
    expect(RelayTransportError.prototype).toBeInstanceOf(Error)
    expect(FanoutRun.prototype).toBeDefined()
    expect(SDK_VERSION).toBe("dev")
    expect(createRelayTransport({ stateDir: "/nonexistent" }).kind).toBe("relay")
    const refused = await pickTransport({ BUNSHIN_TS_TRANSPORT: "hub" }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(refused).toBeInstanceOf(BunshinSessionError)
  })

  it("#given the re-vendored relay transport #when created through the SDK entry #then its artifact surface and retryUnreachableMs are exposed and typed", () => {
    const transport = createRelayTransport({ stateDir: "/nonexistent", retryUnreachableMs: 1_000 })
    const upload: (bytes: Uint8Array) => Promise<{ readonly url: string }> = transport.uploadArtifact
    const fetchArtifact: typeof fetch = transport.fetchArtifact
    expect(typeof upload).toBe("function")
    expect(typeof fetchArtifact).toBe("function")
  })
})
