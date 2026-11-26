import { describe, expect, test } from "bun:test"
import { findRawTlsClients } from "./no-raw-tls-client-scan"

// Security contract (#15071): no real Bun.connect call goes unreported. The oracle is the language, not a scanner:
// each generated program runs against a fake runtime that records every connect call, and a program that made one
// must be reported. Programs the language rejects (syntax) are skipped; over-reporting is allowed.

type Form = { readonly name: string; readonly at: readonly Position[]; readonly declare: string }
type Position = "parameter" | "body" | "nested block" | "after use"
type Reference = { readonly name: string; readonly parameter?: string; readonly body?: string }

const FORMS: readonly Form[] = [
  { name: "var", at: ["body", "nested block", "after use"], declare: "var t = safe;" },
  { name: "let", at: ["body", "nested block", "after use"], declare: "let t = safe;" },
  { name: "const", at: ["body", "nested block", "after use"], declare: "const t = safe;" },
  { name: "function", at: ["body", "nested block", "after use"], declare: "function t() {}" },
  { name: "class", at: ["body", "nested block", "after use"], declare: "class t {}" },
  { name: "catch", at: ["body", "nested block"], declare: "try { throw safe } catch (t) {}" },
  { name: "parameter", at: ["parameter"], declare: "t = safe" },
  { name: "destructured parameter", at: ["parameter"], declare: "{ t } = { t: safe }" },
]

const REFERENCES: readonly Reference[] = [
  { name: "parameter default", parameter: "a = t.connect(o)" },
  { name: "pattern key", parameter: "{ [t.connect(o)]: b } = {}" },
  { name: "body", body: "t.connect(o);" },
  { name: "nested function", body: "(() => t.connect(o))();" },
]

const ALIASES = [
  "var t = globalThis.Bun;",
  "var u = globalThis.Bun; var t = u;",
  "var v = globalThis.Bun; var u = v; var t = u;",
  "var { Bun: t } = globalThis;",
  "var b = globalThis.Bun; for (var t of [b]) {}",
]

function program(form: Form, position: Position, reference: Reference, alias: string): string {
  const parameters = [reference.parameter, position === "parameter" ? form.declare : undefined].filter(Boolean)
  const shadow = position === "parameter" ? "" : position === "nested block" ? `{ ${form.declare} }` : form.declare
  const body = position === "after use" ? [reference.body ?? "", shadow] : [shadow, reference.body ?? ""]
  return `${alias}\nfunction f(${parameters.join(", ")}) {\n${body.join("\n")}\n}\ntry { f() } catch {}\n`
}

function connectsAtRuntime(source: string): boolean | undefined {
  let calls = 0
  const runtime = { Bun: { connect: () => (calls += 1) } }
  const safe = { connect: () => undefined }
  let run: (globalThis: unknown, safe: unknown, o: unknown) => void
  try {
    run = new Function("globalThis", "safe", "o", source) as typeof run
  } catch {
    return undefined
  }
  try {
    run(runtime, safe, {})
  } catch {}
  return calls > 0
}

const programs = FORMS.flatMap((form) =>
  form.at.flatMap((position) =>
    REFERENCES.flatMap((reference) =>
      ALIASES.map((alias, depth) => ({
        label: `${form.name} at ${position}, read in ${reference.name}, alias depth ${depth}`,
        source: program(form, position, reference, alias),
      })),
    ),
  ),
)

describe("generated scope programs against the language (#15071)", () => {
  test("every program that calls the runtime's connect is reported", () => {
    const executed = programs.flatMap(({ label, source }) => {
      const connects = connectsAtRuntime(source)
      return connects === undefined ? [] : [{ label, source, connects }]
    })
    const missed = executed
      .filter(({ connects, source }) => connects && findRawTlsClients(source).length === 0)
      .map(({ label }) => label)
    expect(executed.filter(({ connects }) => connects).length).toBeGreaterThan(100)
    expect(missed).toEqual([])
  })
})
