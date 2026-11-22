import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
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

  test("a send the scan cannot read, bare or through a member, is reported rather than skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "sent-request-scan-"))
    try {
      writeFileSync(join(dir, "bare.ts"), 'const sent = request(kind, {})\nconst named = request("status.get", {})\n')
      writeFileSync(join(dir, "member.ts"), "const sent = client.request(type, {})\n")
      writeFileSync(
        join(dir, "typed.ts"),
        'const sent = client.request<"status.get">(kind, {})\nconst named = client.request<"device.info">("device.info", {})\n',
      )
      writeFileSync(
        join(dir, "shapes.ts"),
        [
          "request(type as RequestType, {})",
          "request(kind satisfies RequestType, {})",
          'request(a ?? "x", {})',
          'request(c ? "a" : "b", {})',
          "request(type /* c */, {})",
          'client.request<Foo<"x">>(kind, {})',
          "client.request<(typeof X)[number]>(kind, {})",
        ].join("\n"),
      )
      writeFileSync(join(dir, "definition.ts"), "class C { request<T extends string>(type: T, params: object) {} }\n")
      expect(scanSentRequestTypes(dir)).toEqual({
        sent: ["device.info", "status.get"],
        unscanned: [
          "bare.ts: kind",
          "member.ts: type",
          "shapes.ts: a",
          "shapes.ts: c",
          "shapes.ts: kind",
          "shapes.ts: kind",
          "shapes.ts: kind",
          "shapes.ts: type",
          "shapes.ts: type",
          "typed.ts: kind",
        ],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // A tripwire on the entry's export names only: that no other package reaches the client is enforced by guard G1
  // (script/remote-import-guard-rules.ts S1: local-api/** is importable only inside device-service-core).
  test("the package entry exports nothing named like a raw local-api client", async () => {
    // A non-literal specifier keeps knip's export check on the entry; a namespace import would mark every export used.
    const entry: Record<string, unknown> = await import(join(import.meta.dir, "..", "..", "src", "index.ts"))
    expect(Object.keys(entry).filter((name) => /localapi|request/i.test(name))).toEqual(["LocalApiError"])
  })
})
