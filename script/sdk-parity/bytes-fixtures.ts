import { createHash } from "node:crypto"

// The scenario table is JSON, so it names bytes by a fixture reference: { "$bytes": { fixture, length, sha256 } }. The
// reference is a table encoding only, never an input form of the SDK (contract.test.ts shows the root refuses it); the
// scenario check replaces it with the fixture's Uint8Array after checking its length and digest.
const FIXTURES: Readonly<Record<string, Uint8Array>> = {
  hi: new TextEncoder().encode("hi"),
}

type Reference = { readonly fixture: string; readonly length: number; readonly sha256: string }

const isReference = (value: unknown): value is { readonly $bytes: Reference } =>
  typeof value === "object" && value !== null && Object.keys(value).length === 1 && "$bytes" in value

export function decodeFixtures(value: unknown, problems: string[], at: string): unknown {
  if (isReference(value)) {
    const { fixture, length, sha256 } = value.$bytes
    const bytes = FIXTURES[fixture]
    if (bytes === undefined) {
      problems.push(`${at}: names bytes fixture ${fixture}, which bytes-fixtures.ts does not have`)
      return value
    }
    const digest = createHash("sha256").update(bytes).digest("hex")
    if (bytes.length !== length || digest !== sha256)
      problems.push(
        `${at}: fixture ${fixture} is ${bytes.length} bytes with sha256 ${digest}, not what the reference says`,
      )
    return bytes
  }
  if (Array.isArray(value)) return value.map((item) => decodeFixtures(item, problems, at))
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeFixtures(item, problems, at)]))
  return value
}
