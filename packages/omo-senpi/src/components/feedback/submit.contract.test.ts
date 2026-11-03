import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { buildDraft } from "./draft"
import provenance from "./fixtures/service-contract/provenance.json"
import { createReportRequestSchema, REPORT_SHA256_HEADER } from "./fixtures/service-contract/reports"
import { parse } from "./fixtures/service-contract/schema"
import { submitReport, type SubmitResult } from "./submit"

const digest = (text: string) => createHash("sha256").update(text).digest("hex")
const redact = (text: string) => ({ text, count: 0 })
// errors.ts imports contract modules that are not copied, so its byte-identical copy is kept as text.
const fixturePath = (file: string) => new URL(`./fixtures/service-contract/${file === "errors.ts" ? "errors.ts.txt" : file}`, import.meta.url)

const serviceErrors = (): ReadonlyArray<readonly [string, number]> => {
  const source = readFileSync(fixturePath("errors.ts"), "utf8")
  const list = /export const ERROR_CODES = \[([\s\S]*?)\] as const/.exec(source)?.[1] ?? ""
  const codes = [...list.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/"([a-z_]+)"/g)].map((match) => match[1] ?? "")
  const traits = /export const ERROR_TRAITS[^=]*= \{([\s\S]*?)\n\};/.exec(source)?.[1] ?? ""
  const statuses = new Map([...traits.matchAll(/^\s+([a-z_]+): \{ status: (\d{3}),/gm)].map((match) => [match[1] ?? "", Number(match[2])]))
  expect(codes.length).toBeGreaterThan(0)
  expect([...statuses.keys()].toSorted()).toEqual(codes.toSorted())
  return codes.map((code) => [code, statuses.get(code) ?? 0] as const)
}

const client = { app: "cli", omo: "5.1.45", senpi: "2026.10.23-1", os: "darwin", arch: "arm64", locale: "ko-KR", channel: "latest" }

describe("report service contract", () => {
  test("#given a pinned server contract #when its fixture is checked #then its bytes match the upstream receipt", () => {
    for (const [file, hash] of Object.entries(provenance.files)) {
      expect(digest(readFileSync(fixturePath(file), "utf8"))).toBe(hash)
      const upstream = process.env.OMO_SERVICE_CONTRACT_SOURCE
      if (upstream !== undefined) expect(digest(readFileSync(join(upstream, file), "utf8"))).toBe(hash)
    }
  })

  test.each([[null, "body"], [null, "headers"], ["synthetic-access-token", "body"], ["synthetic-access-token", "headers"]] as const)("#given a report with token %s #when it is built #then the server accepts its %s", async (accessToken, check) => {
    const draft = buildDraft({ draftId: "drf_contract_1", collected: [{ id: "environment", text: "macOS synthetic fixture" }], redact, destination: "intake", signedIn: accessToken !== null })
    let request: RequestInit | undefined
    await submitReport({
      draft, kind: "bug", description: "Synthetic Unicode report: 한글", redact, client,
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

  test.each(serviceErrors())("#given the service refuses with %s at %i #when a report is sent #then the refusal is typed, never a connection failure", async (code, status) => {
    const draft = buildDraft({ draftId: "drf_contract_2", collected: [], redact, destination: "intake", signedIn: false })
    const result: SubmitResult = await submitReport({
      draft, kind: "bug", description: "Synthetic refusal", redact, client,
      env: {}, stateDir: "unused", apiOrigin: "https://api.example.test", accessToken: null,
      transport: async () => Response.json({ error: { code, message: "synthetic", retryable: false, requestId: "req_contract_1" } }, { status }),
    })
    const codeless: Readonly<Record<string, string>> = {
      secret_detected: "secret-detected",
      rate_limited: "rate-limited",
      unauthorized: "sign-in-required",
      forbidden: "sign-in-required",
      reauth_required: "sign-in-required",
      device_revoked: "sign-in-required",
      writer_floor_mismatch: "sign-in-required",
      account_deleted: "sign-in-required",
      anonymous_closed: "sign-in-required",
    }
    const serviceSide = status >= 500 || code === "not_available" || code === "service_upgrade_required"
    const expected = codeless[code]
    if (expected !== undefined) expect(result).toEqual({ kind: "refused", reason: expected } as SubmitResult)
    else expect(result).toEqual({ kind: "refused", reason: serviceSide ? "service-unavailable" : "service-rejected", code, requestId: "req_contract_1" } as SubmitResult)
  })
})
