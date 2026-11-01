import { expect, mock, test } from "bun:test"
import { b64urlEncode } from "../crypto/vendor/sync-format/jcs.ts"
import { prepareGenesis } from "./prepare.ts"
import { bytes } from "./seal.test-support.ts"
import { vector } from "./vector.test-support.ts"

test.each(["nonce length", "non-NFC RP", "invalid credential", "empty credential", "extra bootstrap key"] as const)(
  "refuses bootstrap %s before sealing or countersigning",
  async (mutation) => {
    const v = await vector()
    const bootstrap = {
      ...v.bootstrap,
      ...(mutation === "nonce length" ? { custody_nonce: b64urlEncode(bytes(32, 5)) } : {}),
      ...(mutation === "extra bootstrap key" ? { extra: true } : {}),
      recovery_key: {
        ...v.bootstrap.recovery_key,
        ...(mutation === "non-NFC RP" ? { rp_id: "e\u0301.test" } : {}),
        ...(mutation === "invalid credential" ? { credential_id: "not/base64url" } : {}),
        ...(mutation === "empty credential" ? { credential_id: "" } : {}),
      },
    }
    const seal = mock(v.capabilities.seal)
    const countersign = mock(v.capabilities.countersign)
    const failure = await prepareGenesis(bootstrap, { seal, countersign }).then(
      () => null,
      (error: unknown) => error,
    )
    expect({ failure, sealCalls: seal.mock.calls.length, countersignCalls: countersign.mock.calls.length }).toMatchObject({
      failure: { reason: "bad_bootstrap" }, sealCalls: 0, countersignCalls: 0,
    })
  },
)
