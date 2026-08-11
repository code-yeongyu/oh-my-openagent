import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

const TELEMETRY_DIR = join(import.meta.dir, "components", "telemetry")
const DIRECT_CAPTURE = /\b[A-Za-z_$][\w$]*\.capture\s*\(/gu
const SANCTIONED_FILE = "omo-native-component.ts"
const SANCTIONED_FUNCTION = "function forwardValidatedCapture("

type SourceFile = {
  readonly name: string
  readonly source: string
}

export function findDirectNativeCaptureViolations(files: readonly SourceFile[]): readonly string[] {
  const violations: string[] = []
  for (const file of files) {
    const sanctionedRange = file.name === SANCTIONED_FILE ? functionRange(file.source, SANCTIONED_FUNCTION) : undefined
    for (const match of file.source.matchAll(DIRECT_CAPTURE)) {
      const offset = match.index
      if (sanctionedRange !== undefined && offset >= sanctionedRange.start && offset < sanctionedRange.end) continue
      const line = file.source.slice(0, offset).split("\n").length
      violations.push(`${file.name}:${line}:${match[0]}`)
    }
  }
  return violations
}

async function nativeModuleSources(): Promise<readonly SourceFile[]> {
  const names = (await readdir(TELEMETRY_DIR))
    .filter((name) => /^omo-native-.*\.ts$/u.test(name) && !name.includes(".test."))
    .sort()
  return Promise.all(names.map(async (name) => ({
    name,
    source: await readFile(join(TELEMETRY_DIR, name), "utf8"),
  })))
}

function functionRange(source: string, signature: string): { readonly start: number; readonly end: number } | undefined {
  const start = source.indexOf(signature)
  if (start < 0) return undefined
  const end = source.indexOf("\n}", start)
  return end < 0 ? undefined : { start, end: end + 2 }
}

describe("OmO Native telemetry capture path", () => {
  test("#given every native telemetry module #when direct transport calls are scanned #then only the validated forwarding boundary is sanctioned", async () => {
    expect(findDirectNativeCaptureViolations(await nativeModuleSources())).toEqual([])
  })

  test("#given a new direct transport capture outside the boundary #when the audit scans it #then the bypass is rejected", async () => {
    const files = await nativeModuleSources()
    const mutated = files.map((file) => file.name === SANCTIONED_FILE
      ? { ...file, source: `${file.source}\nfunction privacyBypass(transport: { capture(message: unknown): void }, message: unknown): void {\n  transport.capture(message)\n}\n` }
      : file)

    expect(findDirectNativeCaptureViolations(mutated)).toEqual([
      expect.stringMatching(/^omo-native-component\.ts:\d+:transport\.capture\($/u),
    ])
  })
})
