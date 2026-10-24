import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { buildDraft } from "./draft"
import provenance from "./fixtures/service-contract/provenance.json"
import { createReportRequestSchema, REPORT_SHA256_HEADER } from "./fixtures/service-contract/reports"
import { parse } from "./fixtures/service-contract/schema"
import { submitReport } from "./submit"

const digest = (text: string) => createHash("sha256").update(text).digest("hex")
const redact = (text: string) => ({ text, count: 0 })

describe("report service contract", () => {
  test("#given a pinned server validator #when its fixture is checked #then its bytes match the upstream receipt", () => {
    for (const [file, hash] of Object.entries(provenance.files)) {
      const fixture = readFileSync(new URL("./fixtures/service-contract/" + file, import.meta.url), "utf8")
      expect(digest(fixture)).toBe(hash)
      const upstream = process.env.OMO_SERVICE_CONTRACT_SOURCE
      if (upstream !== undefined) expect(digest(readFileSync(join(upstream, file), "utf8"))).toBe(hash)
    }
  })

  test.each([[null, "body"], [null, "headers"], ["synthetic-access-token", "body"], ["synthetic-access-token", "headers"]] as const)("#given a report with token %s #when it is built #then the server accepts its %s", async (accessToken, check) => {
    const draft = buildDraft({ draftId: "drf_contract_1", collected: [{ id: "environment", text: "macOS synthetic fixture" }], redact, destination: "intake", signedIn: accessToken !== null })
    let request: RequestInit | undefined
    await submitReport({
      draft, kind: "bug", description: "Synthetic Unicode report: 한글", redact,
      client: { app: "cli", omo: "5.1.45", senpi: "2026.10.23-1", os: "darwin", arch: "arm64", locale: "ko-KR", channel: "latest" },
      env: {}, stateDir: "unused", apiOrigin: "https://api.example.test", accessToken,
      transport: async (_url, init) => { request = init; return Response.json({ id: "rpt_contract" }, { status: 201 }) },
    })
    if (request === undefined) throw new Error("no report request")
    const body = String(request.body)
    const headers = new Headers(request.headers)
    if (check === "body") expect(parse(createReportRequestSchema, JSON.parse(body))).toEqual(JSON.parse(body))
    else {
      expect(headers.get(REPORT_SHA256_HEADER)).toBe(digest(body))
      expect(headers.get("content-length")).toBe(String(Buffer.byteLength(body)))
    }
  })
})
