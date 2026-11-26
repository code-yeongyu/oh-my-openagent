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

function decodeFixtures(value: unknown, problems: string[], at: string): unknown {
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

const isHandle = (value: unknown): boolean =>
  typeof value === "object" && value !== null && Object.keys(value).length === 1 && "$handle" in value

/**
 * A scenario's input as the root's boundary receives it: the ONE function the table check and the boundary test both use
 * (design lane ruling). Each table marker becomes the value it stands for, which JSON cannot carry: `$bytes` the
 * fixture's bytes, `"$callback"` a function, `{ "$handle": ... }` a readable stream.
 */
export function boundaryInput(value: unknown, problems: string[], at: string): unknown {
  const marked = (item: unknown): unknown => {
    if (item === "$callback") return () => undefined
    if (isHandle(item)) return new ReadableStream<Uint8Array>()
    if (isReference(item)) return decodeFixtures(item, problems, at)
    if (Array.isArray(item)) return item.map(marked)
    if (typeof item === "object" && item !== null)
      return Object.fromEntries(Object.entries(item).map(([key, inner]) => [key, marked(inner)]))
    return item
  }
  return marked(value)
}

const ANSWER_MARKER = /^\$answer:[1-9][0-9]*$/

/**
 * The top-level fields of a scenario's input that hold "$answer:<n>": the n-th before-call's answer, supplied when the
 * scenario runs. JSON cannot state that value, so both input checks exempt exactly these fields and check the rest.
 */
export const answerFields = (input: unknown): string[] =>
  typeof input === "object" && input !== null
    ? Object.entries(input)
        .filter(([, value]) => typeof value === "string" && ANSWER_MARKER.test(value))
        .map(([field]) => field)
    : []
