// The deep comparison of a reply with a case's expected message, modulo the case's `variable`
// pointers and the ORACLE-DELTAS.tsv lines that apply to the case (row 3's rule, see replay.ts).
import { resolve } from "node:path"
import { isRecord, parseJson, ROOT, readText } from "./replay-case"

export type Delta = {
  readonly kind: string
  readonly pointer: string
  readonly pattern: readonly string[]
  readonly imported: unknown
  readonly v3: unknown
  matched: number
}

const segments = (pointer: string): string[] =>
  pointer
    .split("/")
    .slice(1)
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"))
const child = (pointer: string, key: string) => `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`

function matches(pattern: readonly string[], pointer: string): boolean {
  const path = segments(pointer)
  const fits = (pat: readonly string[], segs: readonly string[]) =>
    pat.length === segs.length && pat.every((seg, i) => seg === "*" || seg === segs[i])
  if (pattern[0] === "**")
    return path.length >= pattern.length - 1 && fits(pattern.slice(1), path.slice(path.length - pattern.length + 1))
  return fits(pattern, path)
}

export async function loadDeltas(file: string, casePath: string): Promise<Delta[]> {
  const rows = (await readText(file, "delta file"))
    .split("\n")
    .slice(1)
    .filter((line) => line.trim() !== "")
  return rows.flatMap((line) => {
    const [target = "", pointer = "", kind = "", , , imported = "", v3 = ""] = line.split("\t")
    if (target !== "*" && resolve(ROOT, target) !== casePath) return []
    if (kind !== "additive" && kind !== "replaced") return []
    const pattern = (pointer.startsWith("/") ? pointer.slice(1) : pointer).split("/")
    const value = (text: string) => (kind === "replaced" ? parseJson(text, `replaced value of ${pointer}`) : undefined)
    return [{ kind, pointer, pattern, imported: value(imported), v3: value(v3), matched: 0 }]
  })
}

type Context = {
  readonly variable: ReadonlySet<string>
  readonly deltas: readonly Delta[]
  readonly fail: (pointer: string, detail: string) => void
}
export const show = (value: unknown) => JSON.stringify(value)

export function compare(expectedRaw: unknown, actual: unknown, pointer: string, ctx: Context): void {
  if (ctx.variable.has(pointer)) return
  const replaced = ctx.deltas.find(
    (d) => d.kind === "replaced" && matches(d.pattern, pointer) && Bun.deepEquals(d.imported, expectedRaw, true),
  )
  if (replaced) replaced.matched += 1
  const expected = replaced ? replaced.v3 : expectedRaw
  if (actual === undefined) return ctx.fail(pointer, `missing, expected ${show(expected)}`)
  if (isRecord(expected) && isRecord(actual)) {
    for (const key of Object.keys(expected)) compare(expected[key], actual[key], child(pointer, key), ctx)
    for (const key of Object.keys(actual).filter((k) => !(k in expected))) {
      const at = child(pointer, key)
      if (ctx.variable.has(at)) continue
      const additive = ctx.deltas.find((d) => d.kind === "additive" && matches(d.pattern, at))
      if (additive) additive.matched += 1
      else ctx.fail(at, `unexpected member ${show(actual[key])} (no ORACLE-DELTAS line matches it)`)
    }
    return
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length)
      return ctx.fail(pointer, `expected ${expected.length} items, got ${actual.length}`)
    expected.forEach((item, i) => compare(item, actual[i], child(pointer, String(i)), ctx))
    return
  }
  if (!Bun.deepEquals(expected, actual, true)) ctx.fail(pointer, `expected ${show(expected)} got ${show(actual)}`)
}
