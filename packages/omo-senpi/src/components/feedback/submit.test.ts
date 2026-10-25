import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildDraft, type UploadRedactor } from "./draft"
import { submitReport, type ReportTransport } from "./submit"
import { expectUserOnly, readWindowsAcl, unexpectedWindowsReaders } from "./report-file.test-support"


const redactTokens: UploadRedactor = (text) => {
  let count = 0
  const out = text.replace(/ghp_[A-Za-z0-9]{8,}/g, () => {
    count++
    return "<redacted>"
  })
  return { text: out, count }
}

const draft = buildDraft({
  draftId: "drf_1",
  collected: [
    { id: "environment", text: "omo 5.1.36 · macOS · arm64" },
    { id: "session", text: "user: it hangs" },
  ],
  redact: redactTokens,
  destination: "intake",
  signedIn: false,
})

const client = { app: "cli", omo: "5.1.36", senpi: "2026.10.18-1", os: "darwin", arch: "arm64", locale: "en-US", channel: "beta" }

const dirs: string[] = []
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "omo-feedback-"))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const recordingTransport = (status: number, body: unknown) => {
  const sent: { url: string; init: RequestInit }[] = []
  const transport: ReportTransport = async (url, init) => {
    sent.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }
  return { sent, transport }
}

describe("submitReport", () => {
  test("#given a signed-out user who pasted a token into the description #when the report is submitted #then the token never leaves and the delete token is kept on this device", async () => {
    const stateDir = tempDir()
    const { sent, transport } = recordingTransport(201, { id: "rpt_1", deleteToken: "dt_secret" })

    const result = await submitReport({
      draft,
      kind: "bug",
      description: "it hangs, my token ghp_abcdefgh1234 is in the env",
      redact: redactTokens,
      client,
      env: {},
      stateDir,
      apiOrigin: "https://api.example.test",
      accessToken: null,
      transport,
    })

    expect(result).toEqual({ kind: "sent", reportId: "rpt_1" })
    expect(sent).toHaveLength(1)
    const request = sent[0]
    const payload = String(request?.init.body)
    expect(request?.url).toBe("https://api.example.test/v1/reports")
    expect(payload).not.toContain("ghp_")
    expect(JSON.parse(payload).sections.map((section: { id: string }) => section.id)).toEqual(["description", "environment", "session"])
    expect(new Headers(request?.init.headers).get("authorization")).toBeNull()
    const ledger = readFileSync(join(stateDir, "feedback", "sent.json"), "utf8")
    expect(JSON.parse(ledger)).toEqual([{ id: "rpt_1", deleteToken: "dt_secret", createdAt: expect.any(String) }])
    expectUserOnly(join(stateDir, "feedback", "sent.json"), stateDir)
  })

  test("#given the organization turned feedback uploads off #when the report is submitted #then nothing is sent and the report is saved as a private file", async () => {
    const stateDir = tempDir()
    const { sent, transport } = recordingTransport(201, { id: "never" })

    const result = await submitReport({
      draft,
      kind: "feedback",
      description: "idea",
      redact: redactTokens,
      client,
      env: { OMO_DISABLE_FEEDBACK: "1" },
      stateDir,
      apiOrigin: "https://api.example.test",
      accessToken: "at_1",
      transport,
    })

    expect(sent).toHaveLength(0)
    expect(result.kind).toBe("saved")
    if (result.kind !== "saved") throw new Error("expected a saved report")
    const saved = JSON.parse(readFileSync(result.path, "utf8"))
    expect(saved.sections[0]).toEqual({ id: "description", text: "idea" })
    expectUserOnly(result.path, stateDir)
  })

  test("#given the service rejects a secret it still found #when the report is submitted #then the user is told why and no report id is claimed", async () => {
    const { transport } = recordingTransport(400, { error: { code: "secret_detected", detail: { sectionId: "logs" } } })

    const result = await submitReport({
      draft,
      kind: "bug",
      description: "x",
      redact: redactTokens,
      client,
      env: {},
      stateDir: tempDir(),
      apiOrigin: "https://api.example.test",
      accessToken: "at_1",
      transport,
    })

    expect(result).toEqual({ kind: "refused", reason: "secret-detected" })
  })

  test("#given a signed-in user #when the report is submitted #then the request carries their access token and no delete token is stored", async () => {
    const stateDir = tempDir()
    const { sent, transport } = recordingTransport(201, { id: "rpt_2" })

    await submitReport({
      draft,
      kind: "bug",
      description: "x",
      redact: redactTokens,
      client,
      env: {},
      stateDir,
      apiOrigin: "https://api.example.test",
      accessToken: "at_1",
      transport,
    })

    expect(new Headers(sent[0]?.init.headers).get("authorization")).toBe("Bearer at_1")
    expect(() => readFileSync(join(stateDir, "feedback", "sent.json"), "utf8")).toThrow()
  })

  test.each([
    [413, "too-large"],
    [429, "rate-limited"],
    [503, "unavailable"],
  ] as const)("#given the service answers %i #when the report is submitted #then it is refused as %s", async (status, reason) => {
    const { transport } = recordingTransport(status, { error: { code: "x" } })

    const result = await submitReport({
      draft,
      kind: "bug",
      description: "x",
      redact: redactTokens,
      client,
      env: {},
      stateDir: tempDir(),
      apiOrigin: "https://api.example.test",
      accessToken: null,
      transport,
    })

    expect(result).toEqual({ kind: "refused", reason })
  })

  test("#given the report folder cannot be created #when uploads are off and the report is saved #then the user gets a refusal instead of a crash", async () => {
    const stateDir = tempDir()
    writeFileSync(join(stateDir, "feedback"), "not a directory")

    const result = await submitReport({
      draft,
      kind: "bug",
      description: "x",
      redact: redactTokens,
      client,
      env: { OMO_DISABLE_FEEDBACK: "1" },
      stateDir,
      apiOrigin: "https://api.example.test",
      accessToken: null,
      transport: async () => new Response("{}", { status: 201 }),
    })

    expect(result).toEqual({ kind: "refused", reason: "unavailable" })
  })

  test("#given the same draft sent twice #when the report is submitted #then both requests carry the same idempotency key so the intake keeps one report", async () => {
    const { sent, transport } = recordingTransport(201, { id: "rpt_1" })
    const options = {
      draft,
      kind: "bug" as const,
      description: "x",
      redact: redactTokens,
      client,
      env: {},
      stateDir: tempDir(),
      apiOrigin: "https://api.example.test",
      accessToken: null,
      transport,
    }

    await submitReport(options)
    await submitReport(options)

    const keys = sent.map((request) => new Headers(request.init.headers).get("idempotency-key"))
    expect(keys[0]).toBe(`feedback-${draft.draftId}`)
    expect(keys[1]).toBe(keys[0])
  })

  test("#given a key kept from a send whose answer was lost #when a fresh draft is sent with that key #then the request carries the kept key, not one from the new draft", async () => {
    const { sent, transport } = recordingTransport(201, { id: "rpt_1" })

    await submitReport({
      draft,
      kind: "bug",
      description: "x",
      redact: redactTokens,
      client,
      env: {},
      stateDir: tempDir(),
      apiOrigin: "https://api.example.test",
      accessToken: null,
      transport,
      idempotencyKey: "feedback-drf_original",
    })

    expect(new Headers(sent[0]?.init.headers).get("idempotency-key")).toBe("feedback-drf_original")
  })

  test("#given a kept key the intake already holds with another body #when the retry is answered 409 conflict #then the result is already-sent, so the user is not told it failed", async () => {
    const { transport } = recordingTransport(409, { error: { code: "conflict" } })

    const result = await submitReport({
      draft,
      kind: "bug",
      description: "x",
      redact: redactTokens,
      client,
      env: {},
      stateDir: tempDir(),
      apiOrigin: "https://api.example.test",
      accessToken: null,
      transport,
      idempotencyKey: "feedback-drf_original",
    })

    expect(result).toEqual({ kind: "already-sent" })
  })

  test("#given no kept key #when the intake answers 409 conflict #then it is a refusal, not already-sent", async () => {
    const { transport } = recordingTransport(409, { error: { code: "conflict" } })

    const result = await submitReport({
      draft,
      kind: "bug",
      description: "x",
      redact: redactTokens,
      client,
      env: {},
      stateDir: tempDir(),
      apiOrigin: "https://api.example.test",
      accessToken: null,
      transport,
    })

    expect(result).toEqual({ kind: "refused", reason: "unavailable" })
  })
})

describe.skipIf(process.platform !== "win32")("report-file privacy check on Windows", () => {
  test("#given a saved file that Everyone may read #when the privacy check runs #then it names that reader and fails", () => {
    const stateDir = tempDir()
    const path = join(stateDir, "report.json")
    writeFileSync(path, "{}")
    expect(spawnSync("icacls", [path, "/grant", "*S-1-1-0:(R)"], { encoding: "utf8" }).status).toBe(0)

    expect(unexpectedWindowsReaders(readWindowsAcl(path))).toEqual(["S-1-1-0"])
    expect(() => expectUserOnly(path, stateDir)).toThrow()
  })
})
