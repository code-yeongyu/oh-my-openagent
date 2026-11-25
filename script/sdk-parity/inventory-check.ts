import type { ArgvFinding } from "./native-inventory"
import type { NOT_ARGV } from "./not-argv"
import type { CommanderRoute, OpencodeInventory } from "./opencode-inventory"
import type { CliEntry, Edition, Row, Via } from "./schema"

// The comparisons of design section 7.1: each inventory read from the code must match the registry's CLI entries
// exactly. Every message names the route or flag and what to add, so a failure says what to fix.

type EngineSnapshot = { readonly commands: readonly { readonly route: readonly string[]; readonly flags: readonly string[] }[] }

const entries = (rows: readonly Row[], edition: Edition, vias: readonly Via[]): CliEntry[] =>
  rows.flatMap((row) => row.cli.filter((entry) => entry.edition === edition && vias.includes(entry.via)))

const tokensOf = (list: readonly CliEntry[]): Set<string> =>
  new Set(list.flatMap((entry) => [...entry.route, ...Object.keys(entry.flags), ...entry.values]))

export function argvProblems(
  findings: readonly ArgvFinding[],
  rows: readonly Row[],
  scope: { readonly edition: Edition; readonly own: Via; readonly also: readonly Via[] },
  notArgv: typeof NOT_ARGV,
): string[] {
  const named = tokensOf(entries(rows, scope.edition, [scope.own, ...scope.also]))
  const own = tokensOf(entries(rows, scope.edition, [scope.own]))
  const problems: string[] = []
  const excused = new Map<string, Set<string>>()
  for (const finding of findings) {
    if (named.has(finding.token)) continue
    const known = notArgv[finding.file]
    if (known?.tokens.includes(finding.token)) {
      excused.set(finding.file, (excused.get(finding.file) ?? new Set()).add(finding.token))
      continue
    }
    problems.push(
      `${finding.file}:${finding.line} compares argv with "${finding.token}", which no ${scope.edition} row names; add the route or flag to the row of the SDK call it reaches`,
    )
  }
  const scanned = new Set(findings.map((finding) => finding.token))
  for (const token of own)
    if (!scanned.has(token)) problems.push(`a ${scope.edition} row names "${token}", which no dispatch compares; remove it from the row`)
  for (const [file, entry] of Object.entries(notArgv))
    for (const token of entry.tokens)
      if (scope.edition === "native" && !excused.get(file)?.has(token))
        problems.push(`not-argv.ts lists "${token}" in ${file}, which the scan no longer finds there; remove the entry`)
  return problems
}

const isNamespace = (route: CommanderRoute, all: readonly CommanderRoute[]): boolean =>
  route.flags.length === 0 &&
  all.some((other) => other.route.length > route.route.length && route.route.every((word, i) => other.route[i] === word))

export function commanderProblems(inventory: OpencodeInventory, rows: readonly Row[]): string[] {
  const list = entries(rows, "opencode", ["commander"])
  const byRoute = new Map<string, Set<string>>()
  for (const entry of list) {
    const key = entry.route.join(" ")
    byRoute.set(key, new Set([...(byRoute.get(key) ?? []), ...Object.keys(entry.flags)]))
  }
  const problems: string[] = []
  const walked = new Map<string, readonly string[]>([["", inventory.root]])
  for (const route of inventory.routes) if (!isNamespace(route, inventory.routes)) walked.set(route.route.join(" "), route.flags)
  for (const [route, flags] of walked) {
    const named = byRoute.get(route)
    if (named === undefined) {
      if (route !== "") problems.push(`Commander command "${route}" has no row; add it to the row of the SDK call it reaches`)
      continue
    }
    for (const flag of flags)
      if (!named.has(flag)) problems.push(`Commander option ${flag} of "${route || "<root>"}" has no row mapping; name the SDK input field it fills`)
  }
  for (const [route, flags] of byRoute) {
    const real = walked.get(route)
    if (real === undefined) {
      problems.push(`a row names Commander command "${route}", which the program does not register; remove it`)
      continue
    }
    for (const flag of flags)
      if (!real.includes(flag) && !(route === "" && flag.startsWith("-h")) && flag !== "--help" && flag !== "-h")
        problems.push(`a row names option ${flag} of "${route || "<root>"}", which the program does not register; remove it`)
  }
  return problems
}

export function engineProblems(snapshot: EngineSnapshot, rows: readonly Row[]): string[] {
  const fromRows = new Map<string, Set<string>>()
  for (const entry of entries(rows, "native", ["engine"])) {
    const key = entry.route.join(" ")
    fromRows.set(key, new Set([...(fromRows.get(key) ?? []), ...Object.keys(entry.flags)]))
  }
  const problems: string[] = []
  const pinned = new Map(snapshot.commands.map((command) => [command.route.join(" "), new Set(command.flags)]))
  for (const [route, flags] of pinned) {
    const named = fromRows.get(route)
    if (named === undefined) {
      problems.push(`engine command "${route || "<launch>"}" has no row; add the engine.* row that reaches it`)
      continue
    }
    for (const flag of flags)
      if (!named.has(flag)) problems.push(`engine flag ${flag} of "${route || "<launch>"}" has no row mapping; name its SDK input field`)
  }
  for (const [route, flags] of fromRows) {
    const real = pinned.get(route)
    if (real === undefined) problems.push(`a row forwards "${route || "<launch>"}" to the engine, which the snapshot does not list`)
    else for (const flag of flags) if (!real.has(flag)) problems.push(`a row forwards ${flag} of "${route || "<launch>"}", which the snapshot does not list`)
  }
  return problems
}

type ManifestOperation = { readonly name: string; readonly method: string; readonly args: Readonly<Record<string, string>> }

export function manifestProblems(operations: readonly ManifestOperation[], rows: readonly Row[]): string[] {
  const problems: string[] = []
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const operation of operations) {
    const row = byId.get(`toolkit.${operation.method}`)
    if (row === undefined) {
      problems.push(`loop operation ${operation.name} has no row toolkit.${operation.method}`)
      continue
    }
    for (const [field, notation] of Object.entries(operation.args)) {
      const fieldSchema = row.input.properties[field]
      if (fieldSchema === undefined) problems.push(`toolkit.${operation.method} lacks the manifest argument "${field}"`)
      const optional = notation.includes("?")
      if (fieldSchema !== undefined && optional === row.input.required.includes(field))
        problems.push(`toolkit.${operation.method}.${field} is ${optional ? "optional" : "required"} in the manifest; match it`)
    }
  }
  const methods = new Set(operations.map((operation) => `toolkit.${operation.method}`))
  for (const row of rows)
    if (row.kind === "capability" && row.id.startsWith("toolkit.") && row.id !== "toolkit.forSession" && !methods.has(row.id))
      problems.push(`row ${row.id} names a loop operation the manifest does not have`)
  return problems
}
