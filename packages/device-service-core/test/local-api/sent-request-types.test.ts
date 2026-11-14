import { describe, expect, test } from "bun:test"
import * as entry from "../../src/index.ts"
import { OMO_SENT_REQUEST_TYPES, scanSentRequestTypes } from "./sent-request-types.ts"

// Protocol coverage contract: LA21's reply rows and the fake owner's served set must follow what omo actually sends.
describe("the request types omo sends through this package's client", () => {
  test("OMO_SENT_REQUEST_TYPES is exactly what src/ sends, so LA21's exhaustive reply map follows a new send", () => {
    expect([...scanSentRequestTypes().sent]).toEqual([...OMO_SENT_REQUEST_TYPES].toSorted())
  })

  test("every send names its type literally except the vendored client's generic passthrough", () => {
    expect(scanSentRequestTypes().unscanned).toEqual(["local-api/client-open.ts: type"])
  })

  test("the package entry exposes no raw local-api client, so no other package sends past the scan", () => {
    expect(Object.keys(entry).filter((name) => /localapi|request/i.test(name))).toEqual(["LocalApiError"])
  })
})
