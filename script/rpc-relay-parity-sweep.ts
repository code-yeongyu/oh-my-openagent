// The relay parity sweep (#13478): walks the pinned engine's own method table (describeRpcMethodClasses(), the table
// script/rpc-relay-parity.ts renders), sends every method that is not connection_local the same record on two legs (the
// engine locally, and the same engine from a second device through the relay), and classifies each method from the
// two answers. The legs are injected: script/qa/rpc-relay-parity-live.ts drives a real device pair (`bun run qa:rpc-relay-parity`), and
// script/rpc-relay-parity-sweep.test.ts drives fakes in CI.
import { type Answer, compareAnswers, describe, type Verdict } from "./rpc-relay-parity-compare"
import { type ProbeContext, probeRecord, type Route, UNSAFE_TO_PROBE } from "./rpc-relay-parity-probes"

export interface SweepLeg {
  /** The leg's fixture session, named on every session-route record. */
  readonly context: ProbeContext
  readonly send: (route: Route, record: Record<string, unknown>) => Promise<Answer>
}

export interface RouteResult {
  readonly record: Record<string, unknown>
  readonly local: Answer
  readonly relay: Answer
  readonly verdict: Verdict
}

export interface MethodResult {
  readonly method: string
  readonly engineClass: string
  /** Probed only in a form the engine must refuse or that changes nothing (UNSAFE_TO_PROBE). */
  readonly unsafeToProbe: boolean
  readonly routes: Readonly<Record<Route, RouteResult>>
  readonly verdict: Verdict
}

export type VerdictKind = Verdict["kind"]

export interface SweepResult {
  readonly digest: string
  readonly version: number
  readonly excluded: readonly string[]
  readonly methods: readonly MethodResult[]
  readonly counts: Readonly<Record<VerdictKind, number>> & { readonly unsafeToProbe: number }
}

export interface MethodTable {
  readonly version: number
  readonly digest: string
  readonly classes: Readonly<Record<string, string>>
}

const ROUTES: readonly Route[] = ["session", "endpoint"]

/** The method's verdict: the first route that is not `same`, named, or `same` when both routes are. */
function methodVerdict(routes: Readonly<Record<Route, RouteResult>>): Verdict {
  for (const route of ROUTES) {
    const verdict = routes[route].verdict
    if (verdict.kind === "differs") return { kind: "differs", detail: `${route} route: ${verdict.detail}` }
    if (verdict.kind === "missing") return { kind: "missing", error: `${route} route: ${verdict.error}` }
  }
  return { kind: "same" }
}

/** One line for a verdict, the form script/rpc-relay-parity.rows.json records. */
export function verdictLine(result: MethodResult): string {
  const verdict = result.verdict
  const body =
    verdict.kind === "same"
      ? "same"
      : verdict.kind === "differs"
        ? `differs: ${verdict.detail}`
        : `missing: ${verdict.error}`
  return result.unsafeToProbe ? `unsafe-to-probe (harmless form): ${body}` : body
}

/**
 * Sends each method's record on both routes to both legs, local first, and compares the answers. `aliases` maps each
 * leg's per-run values (fixture ids, paths) to shared placeholders; it is read after every answer, so a leg may add the
 * ids its answers mint.
 */
export async function sweepMethods(
  table: MethodTable,
  local: SweepLeg,
  relay: SweepLeg,
  aliases: () => ReadonlyMap<string, string>,
  onResult: (result: MethodResult) => void = () => {},
): Promise<SweepResult> {
  const names = Object.keys(table.classes)
  const excluded = names.filter((name) => table.classes[name] === "connection_local")
  const methods: MethodResult[] = []
  let sequence = 0
  for (const method of names) {
    if (table.classes[method] === "connection_local") continue
    const probe = async (route: Route): Promise<RouteResult> => {
      const id = `rpcpar-${++sequence}`
      const record = probeRecord(method, route, local.context, id)
      const localAnswer = await local.send(route, record)
      const relayAnswer = await relay.send(route, probeRecord(method, route, relay.context, id))
      return {
        record,
        local: localAnswer,
        relay: relayAnswer,
        verdict: compareAnswers(localAnswer, relayAnswer, aliases()),
      }
    }
    const session = await probe("session")
    const routes: Readonly<Record<Route, RouteResult>> = { session, endpoint: await probe("endpoint") }
    const result: MethodResult = {
      method,
      engineClass: table.classes[method] ?? "unknown",
      unsafeToProbe: UNSAFE_TO_PROBE.has(method),
      routes,
      verdict: methodVerdict(routes),
    }
    methods.push(result)
    onResult(result)
  }
  const count = (kind: VerdictKind) => methods.filter((result) => result.verdict.kind === kind).length
  return {
    digest: table.digest,
    version: table.version,
    excluded,
    methods,
    counts: {
      same: count("same"),
      differs: count("differs"),
      missing: count("missing"),
      unsafeToProbe: methods.filter((result) => result.unsafeToProbe).length,
    },
  }
}

/** The raw result as Markdown: counts, then one row per method with both routes' answers. */
export function renderSweep(result: SweepResult, header: string): string {
  const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ")
  const rows = result.methods.map((entry) => {
    const answers = ROUTES.map(
      (route) => `${route}: ${describe(entry.routes[route].local)} / ${describe(entry.routes[route].relay)}`,
    ).join("; ")
    return `| \`${entry.method}\` | ${entry.engineClass} | ${cell(verdictLine(entry))} | ${cell(answers)} |`
  })
  const { same, differs, missing, unsafeToProbe } = result.counts
  return `${header}

Engine method table version ${result.version}, digest \`${result.digest}\`. ${result.methods.length} methods probed,
${result.excluded.length} connection_local excluded.

Counts: same ${same}, differs ${differs}, missing ${missing} (of which probed in a harmless form: ${unsafeToProbe}).

| Method | Engine class | Verdict | Answers (local / relay) |
| --- | --- | --- | --- |
${rows.join("\n")}
`
}
