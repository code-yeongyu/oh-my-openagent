import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix, relative, sep, win32 } from "node:path"
import { describe, expect, test } from "bun:test"

import { REVIEWED_WRITERS, type ReviewedWriter } from "./consent-gate-reviewed.test-support"
import { findGateBypasses } from "./consent-gate-routes.test-support"
import { scanWriterSites, siteKey } from "./consent-gate-sites.test-support"
import { OMO_NATIVE_COMMON_PROPERTY_SCHEMAS, OMO_NATIVE_EVENT_SCHEMAS } from "./event-schemas"

// Every telemetry write to disk, the network, a process, or a transport must sit behind the one
// consent gate, `isOmoNativeTelemetryEnabled` (#10226 H1). Each call site is matched to a reviewed
// entry by file, enclosing function, guards and call text, so an added writer, a writer moved out of
// its gated branch, or a reviewed site that disappeared all fail here.

type SourceFile = { readonly name: string; readonly source: string }

const keyOf = (file: string, key: string): string => `${file}: ${key}`

export function findUngatedWriters(files: readonly SourceFile[], reviewed: readonly ReviewedWriter[] = REVIEWED_WRITERS): readonly string[] {
  const found = new Map<string, number>()
  for (const site of files.flatMap((file) => scanWriterSites(file.name, file.source))) {
    const key = keyOf(site.file, siteKey(site))
    found.set(key, (found.get(key) ?? 0) + 1)
  }
  const expected = new Map<string, number>()
  for (const entry of reviewed) {
    const key = keyOf(entry.file, siteKey(entry))
    expected.set(key, (expected.get(key) ?? 0) + (entry.reason.trim() === "" ? 0 : entry.count ?? 1))
  }
  const violations: string[] = []
  for (const [key, count] of found) {
    const reviewedCount = expected.get(key) ?? 0
    if (count > reviewedCount) violations.push(`unreviewed ${key}${count - reviewedCount > 1 ? ` x${count - reviewedCount}` : ""}`)
  }
  for (const [key, count] of expected) {
    if ((found.get(key) ?? 0) < count) violations.push(`stale ${key}`)
  }
  return violations
}

type PathApi = { readonly relative: (from: string, to: string) => string; readonly sep: string }

// Source names are compared against reviewed entries and prefixes written with "/", so the
// collection point is the one place a platform path becomes a name.
export function sourceName(root: string, path: string, paths: PathApi = { relative, sep }): string {
  return paths.relative(root, path).split(paths.sep).join("/")
}

export function telemetrySources(root: string): readonly SourceFile[] {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])
  return walk(root)
    .filter((path) => path.endsWith(".ts") && !path.includes(".test.") && !path.includes("test-support"))
    .sort()
    .map((path) => ({ name: sourceName(root, path), source: readFileSync(path, "utf8") }))
}

const realSources = (): readonly SourceFile[] => telemetrySources(import.meta.dir)
const unreviewed = (source: string): readonly string[] =>
  findUngatedWriters([...realSources(), { name: "omo-native-new-writer.ts", source }])

describe("telemetry consent gate audit", () => {
  test("#given the telemetry component sources #when writer sites are scanned #then each one is a reviewed, gated writer", () => {
    expect(findUngatedWriters(realSources())).toEqual([])
  })

  test("#given a new file that writes with Bun.write #when the audit scans it #then the site is rejected", () => {
    expect(unreviewed(`export async function persist(path: string): Promise<void> {\n  await Bun.write(path, "x")\n}\n`))
      .toEqual(["unreviewed omo-native-new-writer.ts: persist |  | Bun.write(path)"])
  })

  test("#given a new file that opens a write stream #when the audit scans it #then the site is rejected", () => {
    expect(unreviewed(`import { createWriteStream } from "node:fs"\nexport const open = (path: string) => createWriteStream(path)\n`))
      .toEqual(["unreviewed omo-native-new-writer.ts: open |  | createWriteStream(path)"])
  })

  test.each([
    ["copyFile", `import { copyFile } from "node:fs/promises"\nexport const sink = (a: string) => copyFile(a, "b")\n`, "copyFile(a)"],
    ["copyFileSync", `import { copyFileSync } from "node:fs"\nexport const sink = (a: string) => copyFileSync(a, "b")\n`, "copyFileSync(a)"],
    ["cpSync", `import { cpSync } from "node:fs"\nexport const sink = (a: string) => cpSync(a, "b")\n`, "cpSync(a)"],
    ["appendFile", `import { appendFile } from "node:fs/promises"\nexport const sink = (a: string) => appendFile(a, "x")\n`, "appendFile(a)"],
    ["rename into the state dir", `import { renameSync } from "node:fs"\nexport const sink = (a: string) => renameSync(a, "state/b")\n`, "renameSync(a)"],
    ["an aliased import", `import { writeFileSync as persist } from "node:fs"\nexport const sink = (a: string) => persist(a, "x")\n`, "persist(a)"],
    ["http.request", `import http from "node:http"\nexport const sink = (a: string) => http.request(a)\n`, "http.request(a)"],
    ["https.request", `import * as https from "node:https"\nexport const sink = (a: string) => https.request(a)\n`, "https.request(a)"],
    ["fetch", `export const sink = (a: string) => fetch(a, { method: "POST" })\n`, "fetch(a)"],
  ])("#given a new %s writer #when the audit scans it #then the site is rejected", (_label, source, call) => {
    expect(unreviewed(source)).toEqual([`unreviewed omo-native-new-writer.ts: sink |  | ${call}`])
  })

  test("#given a writer handed out as a value #when the audit scans it #then the reference is a site", () => {
    expect(unreviewed(`import { writeFileSync } from "node:fs"\nexport const deps = { write: writeFileSync }\n`))
      .toEqual(["unreviewed omo-native-new-writer.ts: <module> |  | ref writeFileSync"])
  })

  test("#given the session writers moved out of the gate #when the audit scans the same calls #then each moved site is rejected", () => {
    const gate = "if (!isOmoNativeTelemetryEnabled(options, eventCtx, env)) return\n"
    const files = realSources().map((file) => file.name === "omo-native-session.ts" ? { ...file, source: file.source.replace(gate, "\n") } : file)
    expect(files.find((file) => file.name === "omo-native-session.ts")?.source.includes(gate)).toBe(false)

    const violations = findUngatedWriters(files)
    const moved = violations.filter((line) => line.startsWith("unreviewed omo-native-session.ts:"))
    expect(moved.length).toBe(5)
    expect(violations.filter((line) => line.startsWith("stale omo-native-session.ts:")).length).toBe(5)
    expect(moved.every((line) => !line.includes("isOmoNativeTelemetryEnabled"))).toBe(true)
  })

  test("#given a writer in a subdirectory #when sources are collected #then the nested file is scanned", () => {
    const root = mkdtempSync(join(tmpdir(), "consent-gate-audit-"))
    try {
      mkdirSync(join(root, "nested"))
      writeFileSync(join(root, "nested", "sink.ts"), `export const sink = (a: string) => Bun.write(a, "x")\n`)
      expect(findUngatedWriters(telemetrySources(root), [])).toEqual(["unreviewed nested/sink.ts: sink |  | Bun.write(a)"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test.each([
    ["win32", win32, "C:\\repo\\src", "C:\\repo\\src\\components\\telemetry\\index.ts"],
    ["posix", posix, "/repo/src", "/repo/src/components/telemetry/index.ts"],
  ])("#given a %s source path #when it is named #then the name uses forward slashes", (_label, paths, root, path) => {
    expect(sourceName(root, path, paths)).toBe("components/telemetry/index.ts")
  })

  test("#given a reviewed entry with no site or no reason #when the audit runs #then both are reported", () => {
    const ghost: ReviewedWriter = { file: "gone.ts", fn: "persist", guard: "", call: "writeFileSync(path)", reason: "removed writer" }
    const [first, ...rest] = REVIEWED_WRITERS
    if (first === undefined) throw new Error("the reviewed table is empty")
    expect(findUngatedWriters(realSources(), [{ ...first, reason: " " }, ...rest, ghost])).toEqual([
      `unreviewed ${first.file}: ${siteKey(first)}`,
      "stale gone.ts: persist |  | writeFileSync(path)",
    ])
  })
})

// A reviewed reason can say "goes through the gated fan-in" while the fan-in has stopped reading consent:
// that is how a sampled session sent a raw turn_completed after a mid-session withdrawal. Each emission
// site therefore declares a route, and the route is checked against the source as it is now.
const packageSources = (): readonly SourceFile[] =>
  telemetrySources(join(import.meta.dir, "..", "..")).filter((file) => !file.name.startsWith("components/telemetry/"))
const bypasses = (files: readonly SourceFile[], reviewed: readonly ReviewedWriter[] = REVIEWED_WRITERS): readonly string[] =>
  findGateBypasses(files, reviewed, packageSources())
const FAN_IN_GATE = "      if (state.isConsented?.() !== true) return\n"
const TURN_SEND_GATE = " && options.isConsented()"
const TURN_SITE = "omo-native-turns.ts: createOmoNativeTurnHandler>=> | unless(event.message.role !== \"assistant\") if(options.summary.isRawTurnSampled(options.sessionId)) | options.client.captureEvent(\"turn_completed\")"
const SINK = `export const sink = (client: { captureEvent: (name: string) => void }, isConsented: () => boolean) => {\n  client.captureEvent("x")\n}\n`
const SINK_ENTRY = { file: "omo-native-new-writer.ts", fn: "sink", guard: "", call: "client.captureEvent(\"x\")", reason: "a new producer" }

describe("telemetry consent gate routes", () => {
  test("#given the telemetry sources #when every emission site's route is checked #then each one reaches the consent gate", () => {
    expect(bypasses(realSources())).toEqual([])
  })

  test("#given the source before the mid-session withdrawal fix #when routes are checked #then the raw turn send and the ungated fan-in fail", () => {
    // given
    const before = realSources().map((file) => ({ ...file, source: file.source.replace(FAN_IN_GATE, "").replace(TURN_SEND_GATE, "") }))
    const changed = before.filter((file, index) => file.source !== realSources()[index]?.source).map((file) => file.name)
    expect(changed).toEqual(["omo-native-component.ts", "omo-native-turns.ts"])

    // when
    const violations = bypasses(before)

    // then
    expect(violations).toContain(`bypass ${TURN_SITE} (its guards do not read the consent gate)`)
    expect(violations.some((line) => line.startsWith("bypass omo-native-component.ts: createOmoNativeTelemetryComponent>captureEvent |"))).toBe(true)
    expect(violations.filter((line) => line.endsWith("(the fan-in it relies on does not read the consent gate)")).length)
      .toBe(REVIEWED_WRITERS.filter((entry) => entry.route?.kind === "fan-in").length)
  })

  test("#given only the raw turn send stops reading consent #when routes are checked #then that one site fails", () => {
    const files = realSources().map((file) => ({ ...file, source: file.source.replace(TURN_SEND_GATE, "") }))
    expect(bypasses(files)).toEqual([`bypass ${TURN_SITE} (its guards do not read the consent gate)`])
  })

  test("#given a new emitting call site with no route #when routes are checked #then it fails", () => {
    expect(bypasses([...realSources(), { name: "omo-native-new-writer.ts", source: SINK }]))
      .toEqual(["bypass omo-native-new-writer.ts: sink |  | client.captureEvent(\"x\") (declares no route to the consent gate)"])
  })

  test("#given a new emitting call site routed through the gate but not guarded by it #when routes are checked #then it fails", () => {
    const reviewed = [...REVIEWED_WRITERS, { ...SINK_ENTRY, route: { kind: "gate" } as const }]
    expect(bypasses([...realSources(), { name: "omo-native-new-writer.ts", source: SINK }], reviewed))
      .toEqual(["bypass omo-native-new-writer.ts: sink |  | client.captureEvent(\"x\") (its guards do not read the consent gate)"])
  })

  test("#given the same new call site behind the consent read #when routes are checked #then it passes", () => {
    const guarded = SINK.replace("  client.captureEvent", "  if (!isConsented()) return\n  client.captureEvent")
    const reviewed = [...REVIEWED_WRITERS, { ...SINK_ENTRY, route: { kind: "gate" } as const }]
    expect(bypasses([...realSources(), { name: "omo-native-new-writer.ts", source: guarded }], reviewed)).toEqual([])
  })

  test("#given the unregistered legacy component becomes registered #when routes are checked #then its ungated send fails", () => {
    const registered = [...packageSources(), { name: "extension/component-list.ts", source: "createSenpiTelemetryComponent()\n" }]
    expect(findGateBypasses(realSources(), REVIEWED_WRITERS, registered)).toEqual([
      "bypass index.ts: recordSenpiDailyActive |  | recordDailyActive(input) (its caller index.ts: createSenpiTelemetryComponent>register>on(=>) |  | recordSenpiDailyActive(options) bypasses the consent gate)",
      "bypass index.ts: createSenpiTelemetryComponent>register>on(=>) |  | recordSenpiDailyActive(options) (extension/component-list.ts registers it)",
    ])
  })
})

// The fan-in drops an event whose `$session_id` is the opted-out sentinel and checks no other
// property, because no other exported property can carry a session hash: the allowlists strip
// undeclared keys, and this pins that `$session_id` is the only declared session-hash key.
describe("opted-out sentinel coverage", () => {
  test("#given every event and common property schema #when session-hash keys are listed #then $session_id is the only one", () => {
    const carriers = [OMO_NATIVE_COMMON_PROPERTY_SCHEMAS, ...Object.values(OMO_NATIVE_EVENT_SCHEMAS)]
      .flatMap((schema) => Object.keys(schema))
      .filter((key) => /session/iu.test(key) && key !== "session_role")
    expect([...new Set(carriers)]).toEqual(["$session_id"])
  })
})
