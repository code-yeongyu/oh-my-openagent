import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { chownSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { createOtlpTelemetryTransport } from "./otlp-entry"
import { createBatchId } from "./otlp-spool-dir"
import {
  capture,
  createSpoolRoot,
  decodeLogs,
  logRecordsOf,
  makeTransport,
  recordingFetch,
  spoolNames,
  TEST_SCOPE,
  testResource, testWireProjection, TEST_SPANS } from "./otlp-test-support"
import type { CreateOtlpTelemetryTransportInput } from "./otlp-transport-types"
import type { TelemetryDiagnosticInput } from "./types"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-purge-")
  roots.push(created.cleanup)
  return created.dir
}

/** What earlier consented runs and other processes leave behind: every kind of spool entry. */
function seedSpool(dir: string): void {
  mkdirSync(join(dir, "quarantine"), { recursive: true })
  const now = Date.now()
  writeFileSync(join(dir, `batch-logs-${createBatchId(now)}.otlp`), "sealed")
  writeFileSync(join(dir, `batch-traces-${createBatchId(now)}.sending-${"a".repeat(32)}-${now + 60_000}`), "claimed")
  writeFileSync(join(dir, `active-logs-999-${"b".repeat(32)}.otlp`), "wal")
  writeFileSync(join(dir, "quarantine", `batch-logs-${createBatchId(now)}.otlp`), "corrupt")
}

async function optOut(spoolDir: string, spoolRoot: string, diagnostics: TelemetryDiagnosticInput[]): Promise<void> {
  const transport = await createOtlpTelemetryTransport({
    productEnvPrefix: "OMO_TEST",
    ingestKey: "k",
    spoolDir,
    spoolRoot,
    resource: testResource(),
    scope: TEST_SCOPE, project: testWireProjection, spans: TEST_SPANS,
    env: { DO_NOT_TRACK: "1" },
    diagnostics: (input) => diagnostics.push(input),
    autoStart: false,
  })
  expect(transport).toBeNull()
}

const refusals = (diagnostics: TelemetryDiagnosticInput[]): number =>
  diagnostics.filter((d) => d.event === "telemetry_spool_purge_refused").length

const skipped = (diagnostics: TelemetryDiagnosticInput[]): TelemetryDiagnosticInput[] =>
  diagnostics.filter((d) => d.event === "telemetry_spool_purge_skipped")

const currentUid = typeof process.getuid === "function" ? process.getuid() : undefined

/** The escape check is live only when every caller names the spool root: it is a required input. */
const spoolRootIsRequired: undefined extends CreateOtlpTelemetryTransportInput["spoolRoot"] ? false : true = true

describe("the opt-out purge skips every spool-named entry that is not a regular file of the current user, and keeps going", () => {
  test("#given a spool-named directory between the spool's files #when the purge runs #then the directory survives untouched, every spool file is deleted, and one skip is reported with its kind and no path", async () => {
    // given
    const dir = root()
    seedSpool(dir)
    const named = join(dir, `batch-logs-${createBatchId(Date.now() - 1)}.otlp`)
    mkdirSync(named)
    writeFileSync(join(named, "inside.txt"), "foreign")
    const diagnostics: TelemetryDiagnosticInput[] = []

    // when
    await optOut(dir, dirname(dir), diagnostics)

    // then
    expect(spoolNames(dir)).toEqual([named.slice(dir.length + 1)])
    expect(readdirSync(named)).toEqual(["inside.txt"])
    expect(skipped(diagnostics)).toEqual([{ event: "telemetry_spool_purge_skipped", source: "otlp", entryKind: "directory" }])
    expect(diagnostics.filter((d) => d.event === "telemetry_spool_sweep_failed")).toEqual([])
  })

  test("#given a spool-named symlink to a directory #when the purge runs #then the link and its target are untouched, the rest is purged, and the skip is reported as a symlink", async () => {
    // given
    const dir = root()
    seedSpool(dir)
    const target = join(dirname(dir), "link-target")
    mkdirSync(target)
    writeFileSync(join(target, "keep.txt"), "keep")
    const linkName = `batch-traces-${createBatchId(Date.now() - 1)}.otlp`
    symlinkSync(target, join(dir, linkName), "junction")
    const diagnostics: TelemetryDiagnosticInput[] = []

    // when
    await optOut(dir, dirname(dir), diagnostics)

    // then
    expect(spoolNames(dir)).toEqual([linkName])
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("keep")
    expect(skipped(diagnostics).map((d) => d.entryKind)).toEqual(["symlink"])
  })

  test.skipIf(currentUid !== 0)("#given a spool-named file owned by another user (needs root to chown) #when the purge runs #then it survives and the skip is reported as foreign_owner", async () => {
    // given
    const dir = root()
    seedSpool(dir)
    const foreign = `active-logs-1-${"c".repeat(32)}.otlp`
    writeFileSync(join(dir, foreign), "theirs")
    chownSync(join(dir, foreign), 65534, 65534)
    const diagnostics: TelemetryDiagnosticInput[] = []

    // when
    await optOut(dir, dirname(dir), diagnostics)

    // then
    expect(spoolNames(dir)).toEqual([foreign])
    expect(skipped(diagnostics).map((d) => d.entryKind)).toEqual(["foreign_owner"])
  })
})

describe("the opt-out purge refuses a spool directory it does not own or that lies outside the caller's spool root", () => {
  test.skipIf(currentUid === undefined)("#given the spool directory belongs to another user #when the purge runs #then it is refused, counted, and nothing is deleted", async () => {
    // given
    const dir = root()
    seedSpool(dir)
    const before = spoolNames(dir)
    const diagnostics: TelemetryDiagnosticInput[] = []
    const uid = spyOn(process, "getuid").mockImplementation(() => (currentUid ?? 0) + 1)

    // when
    try {
      await optOut(dir, dirname(dir), diagnostics)
    } finally {
      uid.mockRestore()
    }

    // then
    expect(spoolNames(dir)).toEqual(before)
    expect(refusals(diagnostics)).toBe(1)
  })

  test("#given a plain spool directory that is not below the spool root the caller passed #when the process starts opted out or consent is withdrawn mid-run #then both purges are refused, counted, and the spool is untouched", async () => {
    // given
    const dir = root()
    seedSpool(dir)
    const before = spoolNames(dir)
    const spoolRoot = join(dirname(dir), "expected-root")
    mkdirSync(spoolRoot)
    const atStart: TelemetryDiagnosticInput[] = []
    const midRun: TelemetryDiagnosticInput[] = []
    const transport = makeTransport(dir, { spoolRoot, consent: () => false, diagnostics: (input) => midRun.push(input) })

    // when
    await optOut(dir, spoolRoot, atStart)
    await transport.flush()

    // then
    expect(spoolRootIsRequired).toBe(true)
    expect(spoolNames(dir)).toEqual(before)
    expect(refusals(atStart)).toBe(1)
    expect(refusals(midRun)).toBe(1)
  })
})

describe("the opt-out purge deletes only what the spool created, only inside a verified spool directory", () => {
  test("#given foreign files and a foreign subdirectory next to the spool's own files #when the purge runs #then only the spool's own files go and the foreign ones survive", async () => {
    // given
    const dir = root()
    seedSpool(dir)
    writeFileSync(join(dir, "notes.txt"), "foreign")
    mkdirSync(join(dir, "projects", "keep"), { recursive: true })
    writeFileSync(join(dir, "projects", "keep", "batch-logs-not-ours.otlp"), "foreign")
    writeFileSync(join(dir, "quarantine", "readme.md"), "foreign")
    const diagnostics: TelemetryDiagnosticInput[] = []

    // when
    await optOut(dir, dirname(dir), diagnostics)

    // then
    expect(spoolNames(dir)).toEqual(["notes.txt", "projects", "quarantine"])
    expect(readdirSync(join(dir, "quarantine"))).toEqual(["readme.md"])
    expect(readdirSync(join(dir, "projects", "keep"))).toEqual(["batch-logs-not-ours.otlp"])
    expect(refusals(diagnostics)).toBe(0)
  })

  test("#given the spool directory is a symlink #when the purge runs #then it is refused, counted, and the link target is untouched", async () => {
    // given
    const base = root()
    const target = join(dirname(base), "elsewhere")
    seedSpool(target)
    const before = spoolNames(target)
    symlinkSync(target, base, "junction")
    const diagnostics: TelemetryDiagnosticInput[] = []

    // when
    await optOut(base, dirname(base), diagnostics)

    // then
    expect(spoolNames(target)).toEqual(before)
    expect(readdirSync(join(target, "quarantine")).length).toBe(1)
    expect(refusals(diagnostics)).toBe(1)
  })

  test("#given a spool directory whose real path escapes the expected spool root #when the purge runs #then it is refused, counted, and nothing is deleted", async () => {
    // given
    const base = root()
    const spoolRoot = join(dirname(base), "root")
    const outside = join(dirname(base), "outside")
    mkdirSync(spoolRoot, { recursive: true })
    mkdirSync(outside, { recursive: true })
    symlinkSync(outside, join(spoolRoot, "link"), "junction")
    const dir = join(spoolRoot, "link", "telemetry-spool")
    seedSpool(dir)
    const before = spoolNames(dir)
    const diagnostics: TelemetryDiagnosticInput[] = []

    // when
    await optOut(dir, spoolRoot, diagnostics)

    // then
    expect(spoolNames(join(outside, "telemetry-spool"))).toEqual(before)
    expect(refusals(diagnostics)).toBe(1)
  })
})

describe("opt-out purges the spool", () => {
  for (const env of [{ DO_NOT_TRACK: "1" }, { OTEL_SDK_DISABLED: "true" }, { OMO_TEST_SEND_ANONYMOUS_TELEMETRY: "0" }]) {
    test(`#given a spool left by earlier runs #when the process starts opted out (${Object.keys(env)[0]}) #then every batch, claim, WAL and quarantined file is deleted`, async () => {
      // given
      const dir = root()
      seedSpool(dir)

      // when
      const transport = await createOtlpTelemetryTransport({
        productEnvPrefix: "OMO_TEST",
        ingestKey: "k",
        spoolDir: dir,
        spoolRoot: dirname(dir),
        resource: testResource(),
        scope: TEST_SCOPE, project: testWireProjection, spans: TEST_SPANS,
        env,
        autoStart: false,
      })

      // then
      expect(transport).toBeNull()
      expect(existsSync(dir)).toBe(false)
    })
  }

  test("#given consent is withdrawn mid-run #when the transport flushes #then batches of other processes, claims, WAL and quarantine are deleted too", async () => {
    // given
    const dir = root()
    seedSpool(dir)
    let consent = true
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { consent: () => consent, fetch })
    capture(transport, "feature_used", { feature: "a" })
    consent = false

    // when
    await transport.flush()

    // then
    expect(calls.length).toBe(0)
    expect(spoolNames(dir)).toEqual([])
  })

  test("#given a second live process that still has consent #when the first one purges #then the second keeps working without throwing and delivers what it captures afterwards", async () => {
    // given
    const dir = root()
    let consentA = true
    const diagnostics: TelemetryDiagnosticInput[] = []
    const a = makeTransport(dir, { consent: () => consentA, pid: 11, bootId: "1".repeat(32) })
    const { calls, fetch } = recordingFetch()
    const b = makeTransport(dir, { fetch, pid: 12, bootId: "2".repeat(32), diagnostics: (input) => diagnostics.push(input) })
    capture(b, "feature_used", { feature: "before-purge" })
    consentA = false

    // when
    await a.flush()
    await b.flush()
    capture(b, "feature_used", { feature: "after-purge" })
    await b.flush()

    // then
    const features = calls.flatMap((c) => logRecordsOf(decodeLogs(c.body))).map((r) => r.attributes.find((kv) => kv.key === "omo.feature")?.value?.value)
    expect(features).toContainEqual({ case: "stringValue", value: "after-purge" })
    expect(diagnostics.filter((d) => d.event === "telemetry_spool_write_failed")).toEqual([])
    expect(spoolNames(dir)).toEqual([])
  })
})
