import { z } from "zod"
import { AuditError, byteGate, CASES, classifyFailure, providerSchema, timingGate, timingsSchema } from "./contracts"
import { join } from "node:path"

const receiptSchema = z.object({
  schemaVersion: z.literal(1), case: z.enum(CASES), machine: z.string(), binarySha256: z.string().regex(/^[a-f0-9]{64}$/),
  versions: z.object({ bun: z.string(), node: z.string() }), pass: z.boolean(), exitCode: z.number().int(),
}).passthrough()
type Receipt = z.infer<typeof receiptSchema>
const sizeSchema = z.object({ size: z.number().int().positive(), target: z.string(), sha256: z.string() })
const startupSchema = z.object({ version: timingsSchema, oneshot: timingsSchema })
const fixtureSchema = z.object({ fixtures: z.array(z.object({ path: z.string(), markdown: z.string(), text: z.string(), status: z.literal(200), converted: z.literal(true),
  finalUrl: z.string(), truncated: z.literal(false), outputTruncated: z.literal(false),
})).length(3) })
export function behaviorPass(name: "rpc" | "extension" | "photon" | "changelog", value: unknown): boolean {
  if (!z.object({ pass: z.literal(true), exitCode: z.literal(0) }).safeParse(value).success) return false
  switch (name) {
    case "photon": return z.object({ width: z.literal(800), height: z.literal(400), wasResized: z.literal(true), outputBytes: z.number().positive(),
      independentlyDecoded: z.object({ width: z.literal(800), height: z.literal(400) }),
    }).safeParse(value).success
    case "changelog": return z.object({ entriesMatchShipped: z.literal(true), whatsNew: z.literal(true), expectedEntries: z.array(z.string().min(1)).min(1) }).safeParse(value).success
    case "extension": {
      const result = z.object({ modes: z.array(z.object({ mode: z.enum(["classic", "multi"]), sentinel: z.string(), label: z.string(), helperValue: z.literal(42),
        identity: z.object({ typebox: z.literal(true), tui: z.literal(true), engine: z.literal(true) }),
      })).length(2) }).safeParse(value)
      return result.success && new Set(result.data.modes.map((mode) => mode.mode)).size === 2 && result.data.modes.every((mode) => mode.sentinel === `audit-identity-${mode.mode}` && mode.label === mode.sentinel)
    }
    case "rpc": {
      const result = z.object({ attached: z.literal(true), workerTeardown: z.literal(true), sessions: z.array(z.object({ sessionId: z.string(), sentinel: z.string(), text: z.string(), stopReason: z.literal("stop") })).length(2) }).safeParse(value)
      return result.success && new Set(result.data.sessions.map((session) => session.sessionId)).size === 2 && new Set(result.data.sessions.map((session) => session.sentinel)).size === 2 && result.data.sessions.every((session) => session.text === session.sentinel)
    }
    default: { const exhaustive: never = name; throw exhaustive }
  }
}
function canonicalMarkdown(text: string, base: string): string {
  const urlBase = base.replace(":PORT", ":1").replace("/fixtures/base/final", "/fixtures/assets/")
  return text.replace(/(!?\[[^\]]*\]\()([^\s)]+)(\))/g, (_all, prefix: string, href: string, suffix: string) => {
    if (/^(?:mailto:|tel:|data:|#)/.test(href)) return `${prefix}${href}${suffix}`
    return `${prefix}${new URL(href.replace(":PORT", ":1"), urlBase).href.replace(":1/", ":PORT/")}${suffix}`
  }).replace(/\r\n/g, "\n").trimEnd()
}
export async function compareDirectories(baselineDir: string, postDir: string, gate: "p0" | "p1") {
  const read = async (directory: string, name: typeof CASES[number]): Promise<Receipt> => {
    const receipt = receiptSchema.parse(await Bun.file(join(directory, `${name}.json`)).json())
    if (receipt.case !== name) throw new AuditError("compare", `wrong case in ${name}.json`)
    return receipt
  }
  const baseline = await Promise.all(CASES.map((name) => read(baselineDir, name)))
  const post = await Promise.all(CASES.map((name) => read(postDir, name)))
  const checks: { readonly name: string; readonly pass: boolean; readonly detail: unknown }[] = []
  const baseBytes = sizeSchema.parse(baseline[0])
  const postBytes = sizeSchema.parse(post[0])
  const available = z.object({ targets: z.array(z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), target: z.string(), size: z.number().int().positive() }),
    z.object({ status: z.literal("no-baseline"), target: z.string() }),
  ])) }).parse(baseline.find((row) => row.case === "bytes-targets")).targets
  const sizes = new Map<string, { readonly target: string; readonly size: number }>()
  for (const target of available) {
    switch (target.status) {
      case "available": sizes.set(target.target, target); break
      case "no-baseline": break
      default: { const exhaustive: never = target; throw exhaustive }
    }
  }
  sizes.set(baseBytes.target, baseBytes)
  checks.push({ name: "bytes", ...byteGate(postBytes, sizes.get(postBytes.target), gate), detail: { target: postBytes.target } })
  checks.push({ name: "artifact-consistency", pass: baseline.every((row) => row.binarySha256 === baseBytes.sha256) && post.every((row) => row.binarySha256 === postBytes.sha256), detail: "every case must refer to its captured binary" })
  for (const [index, name] of CASES.entries()) {
    const before = baseline[index]
    const after = post[index]
    if (!before || !after) throw new AuditError("compare", "incomplete capture")
    switch (name) {
      case "bytes": break
      case "graph": {
        const graph = z.object({ moduleCount: z.number().int().min(1000), metafileSha256: z.string() }).safeParse(after)
        checks.push({ name, pass: after.pass && graph.success, detail: graph.success ? graph.data : graph.error.message })
        break
      }
      case "startup": {
        const timingBefore = startupSchema.parse(before)
        const timingAfter = startupSchema.parse(after)
        checks.push({ name: "startup-machine", pass: before.machine === after.machine && before.versions.bun === after.versions.bun, detail: { baseline: before.machine, post: after.machine } })
        for (const kind of ["version", "oneshot"] as const) {
          const result = timingGate(timingBefore[kind], timingAfter[kind], kind)
          checks.push({ name: `startup-${kind}`, pass: result.pass, detail: result })
        }
        break
      }
      case "providers": {
        const rows = z.object({ rows: z.array(providerSchema).length(6) }).parse(after).rows
        const prior = z.object({ rows: z.array(providerSchema).length(6) }).parse(before).rows
        const unique = new Set(rows.map((row) => `${row.mode}/${row.api}`)).size === 6
        const pass = unique && rows.every((row) => (row.requestObserved && row.failureClass === "auth" && classifyFailure(row.errorMessage) === "auth" && row.stopReason === "error") ||
          (gate === "p0" && row.failureClass === "module-resolution" && classifyFailure(row.errorMessage) === "module-resolution" && prior.some((base) => base.api === row.api && base.mode === row.mode && base.failureClass === "module-resolution")))
        checks.push({ name, pass, detail: rows })
        break
      }
      case "webfetch": {
        const base = fixtureSchema.parse(before).fixtures
        const current = fixtureSchema.parse(after).fixtures
        const pass = after.pass && current.every((fixture) => {
          const prior = base.find((row) => row.path === fixture.path)
          return prior !== undefined && fixture.finalUrl === prior.finalUrl && fixture.text.trimEnd() === prior.text.trimEnd() &&
            canonicalMarkdown(fixture.markdown, fixture.finalUrl) === canonicalMarkdown(prior.markdown, prior.finalUrl)
        })
        checks.push({ name, pass, detail: "three converted fixtures; exact text and canonical link targets" })
        break
      }
      case "skills": checks.push({ name, pass: after.pass && JSON.stringify(before.entries) === JSON.stringify(after.entries), detail: "sorted path/size/SHA256 manifest equality; review approved skill changes separately" }); break
      case "bytes-targets": checks.push({ name, pass: after.pass, detail: "best-effort release inventory; missing targets retain the 150 MiB ceiling" }); break
      case "rpc":
      case "extension":
      case "photon":
      case "changelog": checks.push({ name, pass: behaviorPass(name, after), detail: after }); break
      default: { const exhaustive: never = name; throw exhaustive }
    }
  }
  return { gate, pass: checks.every((check) => check.pass), checks }
}
