import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { OMO_SENT_REQUEST_TYPES, scanSentRequestTypes } from "./sent-request-types.ts"

// Protocol coverage contract: LA21's reply rows and the fake owner's served set must follow what omo actually sends.
describe("the request types omo sends through this package's client", () => {
  test("OMO_SENT_REQUEST_TYPES is exactly what src/ sends, so LA21's exhaustive reply map follows a new send", () => {
    expect([...scanSentRequestTypes().sent]).toEqual([...OMO_SENT_REQUEST_TYPES].toSorted())
  })

  test("every send names its type literally except the vendored client's generic passthrough", () => {
    expect(scanSentRequestTypes().unscanned).toEqual(["local-api/client-open.ts: type"])
  })

  test("the package entry exposes no raw local-api client, so no other package sends past the scan", async () => {
    // A non-literal specifier keeps knip's export check on the entry; a namespace import would mark every export used.
    const entry: Record<string, unknown> = await import(join(import.meta.dir, "..", "..", "src", "index.ts"))
    expect(Object.keys(entry).filter((name) => /localapi|request/i.test(name))).toEqual(["LocalApiError"])
  })
})
