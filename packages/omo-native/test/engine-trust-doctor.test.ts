import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { engineTrustDoctorLines, readEngineTrustRecords } from "../engine-trust-doctor"

const sha = "0123456789ab".padEnd(64, "c")
const other = "f".repeat(64)
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const marker = (file = "/trust/gen.pem", automatic: "os" | "fallback" = "os") => ({ file, sha256: sha, automatic })
const drop = { code: "openssl-default-file-malformed", file: "/etc/ssl/cert.pem", cause: "ordinary-block-unparseable", blockIndex: 3, narrowing: true }
const record = (generation: string, action: string, codes: unknown[]) => ({ v: 1, at: "2026-11-05T00:00:00.000Z", pid: 1, kind: "long-lived", action, generation, codes })

describe("engine trust doctor lines (design revision 11)", () => {
  test("#given the marker's generation dropped the default file #when formatted #then one INFO line names the file, cause, block and narrowing", () => {
    expect(engineTrustDoctorLines({ platform: "darwin", marker: marker(), records: [record(sha, "import-exec", [{ code: "trust-generation-recognized" }, drop])] })).toEqual([
      "INFO engine trust: default file /etc/ssl/cert.pem dropped: ordinary-block-unparseable, block 3, narrowing=true",
    ])
  })

  test("#given the marker's generation kept the default file #when formatted #then one INFO line says kept", () => {
    expect(engineTrustDoctorLines({ platform: "darwin", marker: marker(), records: [record(sha, "ensure", [])] })).toEqual([
      "INFO engine trust: generation 0123456789ab, default-file: kept",
    ])
  })

  test("#given the default file could not be read #when formatted #then the line says unreadable, never kept", () => {
    expect(engineTrustDoctorLines({ platform: "darwin", marker: marker(), records: [record(sha, "import-exec", [{ code: "openssl-default-file-malformed" }])] })).toEqual([
      "INFO engine trust: generation 0123456789ab, default-file: unreadable",
    ])
  })

  test("#given several records #when formatted #then only the last import-exec or ensure record of the marker's generation counts", () => {
    const records = [
      record(sha, "import-exec", [drop]),
      record(other, "ensure", []),
      record(sha, "ensure", []),
      record(sha, "adopt", [drop]),
      record(other, "import-exec", [drop]),
    ]
    expect(engineTrustDoctorLines({ platform: "darwin", marker: marker(), records })).toEqual(["INFO engine trust: generation 0123456789ab, default-file: kept"])
  })

  test("#given a generation that never read the default file #when formatted #then doctor states no default-file status", () => {
    const records = [record(sha, "ensure", [])]
    expect(engineTrustDoctorLines({ platform: "linux", marker: marker(), records })).toEqual([])
    expect(engineTrustDoctorLines({ platform: "win32", marker: marker(), records })).toEqual([])
    expect(engineTrustDoctorLines({ platform: "darwin", marker: marker("/trust/gen.pem", "fallback"), records })).toEqual([])
    expect(engineTrustDoctorLines({ platform: "darwin", marker: marker("/trust/gen.pem", "fallback"), records: [record(sha, "ensure", [{ code: "openssl-default-file-malformed" }])] })).toEqual([])
  })

  test("#given no marker or no record of its generation #when formatted #then doctor prints nothing", () => {
    expect(engineTrustDoctorLines({ platform: "darwin", marker: undefined, records: [record(sha, "ensure", [drop])] })).toEqual([])
    expect(engineTrustDoctorLines({ platform: "darwin", marker: marker(), records: [record(other, "ensure", [drop]), record(sha, "adopt", [])] })).toEqual([])
    expect(engineTrustDoctorLines({ platform: "darwin", marker: marker(), records: [] })).toEqual([])
  })

  test("#given the rotated and the current log beside the generation #when read #then the newest record wins and broken lines are skipped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-engine-trust-doctor-"))
    roots.push(dir)
    writeFileSync(join(dir, "diagnostics.1.jsonl"), `${JSON.stringify(record(sha, "ensure", []))}\n`)
    writeFileSync(join(dir, "diagnostics.jsonl"), `not json\n${JSON.stringify(record(sha, "import-exec", [drop]))}\n{"trunc`)
    const records = await readEngineTrustRecords(marker(join(dir, `${sha}.pem`)))
    expect(engineTrustDoctorLines({ platform: "darwin", marker: marker(), records })).toEqual([
      "INFO engine trust: default file /etc/ssl/cert.pem dropped: ordinary-block-unparseable, block 3, narrowing=true",
    ])
  })

  test("#given no log beside the generation #when read #then it fails open with no records", async () => {
    expect(await readEngineTrustRecords(marker(join(tmpdir(), "omo-engine-trust-doctor-absent", `${sha}.pem`)))).toEqual([])
    expect(await readEngineTrustRecords(undefined)).toEqual([])
  })
})
