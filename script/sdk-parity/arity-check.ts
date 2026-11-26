import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { REPO_ROOT } from "./registry"
import type { CliEntry, Row } from "./schema"

// Review 6061874518 M4: the rows' parsing contract (`field` takes a value, `field=true` is presence) is checked against
// each command's own parser, never against a type annotation. Sources, each independent of the rows: the OpenCode
// Commander program's live option arity, the loop CLI's `readValue`/`hasFlag` reads, the native thread and remote
// session parsers' value and switch tables, and the installed engine's own argv parser for the root launch. The other
// native verbs read their flags by hand-written comparisons; their arity is declared in the rows and reviewed as such.

export type Arity = "value" | "presence"
export type AritySource = {
  readonly name: string
  readonly arityOf: (entry: CliEntry, flag: string) => Arity | undefined
}

const SKIP = new Set(["render", "process", "when", "parse"])
const declared = (target: string): Arity => (target.includes("=") ? "presence" : "value")

export function arityProblems(rows: readonly Row[], sources: readonly AritySource[]): string[] {
  const problems: string[] = []
  for (const row of rows)
    for (const entry of row.cli)
      for (const [flag, target] of Object.entries(entry.flags)) {
        if (SKIP.has(target) || target.startsWith("root.")) continue
        for (const source of sources) {
          const actual = source.arityOf(entry, flag)
          if (actual !== undefined && actual !== declared(target))
            problems.push(
              `row ${row.id}: ${entry.edition} "${[...entry.route, flag].join(" ")}" is ${declared(target)} in the row but ${actual} in ${source.name}; write it as ${actual === "presence" ? `${target}=true` : target.split("=")[0]}`,
            )
        }
      }
  return problems
}

type CommanderLike = {
  readonly options?: readonly {
    readonly long?: string
    readonly short?: string
    readonly required?: boolean
    readonly optional?: boolean
  }[]
  readonly commands?: readonly CommanderLike[]
  name(): string
  aliases(): readonly string[]
}

export function commanderArity(program: CommanderLike): AritySource {
  const arity = new Map<string, Arity>()
  const walk = (command: CommanderLike, path: readonly string[]): void => {
    for (const option of command.options ?? [])
      for (const flag of [option.long, option.short])
        if (flag !== undefined)
          arity.set(
            [...path, flag].join(" "),
            option.required === true || option.optional === true ? "value" : "presence",
          )
    for (const child of command.commands ?? [])
      for (const name of [child.name(), ...child.aliases()]) walk(child, [...path, name])
  }
  walk(program, [])
  return {
    name: "the Commander program",
    arityOf: (entry, flag) =>
      entry.via === "commander" ? (arity.get([...entry.route, flag].join(" ")) ?? arity.get(flag)) : undefined,
  }
}

export function loopArity(sourceDir: string): AritySource {
  const text = readdirSync(sourceDir)
    .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
    .map((name) => readFileSync(join(sourceDir, name), "utf8"))
    .join("\n")
  const read = (pattern: RegExp): Set<string> => new Set([...text.matchAll(pattern)].map((match) => match[1] ?? ""))
  const values = read(/readValue\(argv, "(--[a-z-]+)"\)/g)
  const switches = read(/hasFlag\(argv, "(--[a-z-]+)"\)/g)
  return {
    name: "the loop CLI's readValue/hasFlag",
    arityOf: (entry, flag) =>
      entry.via !== "loop" ? undefined : values.has(flag) ? "value" : switches.has(flag) ? "presence" : undefined,
  }
}

// The native thread parser takes `values:` and `booleans:` per verb; the remote session parser `values:` and `switches:`.
export function nativeTableArity(repoRoot: string): AritySource {
  const tables = new Map<string, Map<string, Arity>>()
  const scan = (file: string, prefix: string, valueKey: string, presenceKey: string): void => {
    const text = readFileSync(join(repoRoot, file), "utf8")
    const arity = tables.get(prefix) ?? new Map<string, Arity>()
    // A table may spread a named constant (`booleans: [...COMMON, ...]`): its literal is read from the same file.
    const constant = (name: string): string => new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(text)?.[1] ?? ""
    for (const [key, kind] of [
      [valueKey, "value"],
      [presenceKey, "presence"],
    ] as const)
      for (const match of text.matchAll(new RegExp(`${key}: \\[([^\\]]*)\\]`, "g"))) {
        const body = (match[1] ?? "").replace(/\.\.\.([A-Z_]+)/g, (_spread, name: string) => constant(name))
        for (const flag of body.matchAll(/"(--[a-z-]+)"/g)) arity.set(flag[1] ?? "", kind)
      }
    tables.set(prefix, arity)
  }
  scan("packages/omo-native/bin/lib/thread.js", "thread", "values", "booleans")
  scan("packages/omo-native/remote-session-args.ts", "remote", "values", "switches")
  return {
    name: "the native parser tables",
    arityOf: (entry, flag) => (entry.via === "launcher" ? tables.get(entry.route[0] ?? "")?.get(flag) : undefined),
  }
}

// The engine root launch: a presence flag leaves the next word as a message; a value flag consumes it. Gated flags are
// probed with their gate on, as the rows describe them.
export function engineRootArity(
  parseArgs: (argv: string[], options: { grokNeoEnabled: boolean }) => unknown,
): AritySource {
  const probe = "sdk-parity-arity-probe"
  return {
    name: "the engine's argv parser",
    arityOf: (entry, flag) => {
      if (entry.via !== "engine" || entry.route.length > 0) return undefined
      const messages = Reflect.get(Object(parseArgs([flag, probe], { grokNeoEnabled: true })), "messages")
      return Array.isArray(messages) && messages.includes(probe) ? "presence" : "value"
    },
  }
}

// The pinned engine's own argv parser. Its package exports no CLI subpath, so it is loaded from the installed files.
export async function engineParseArgs(): Promise<(argv: string[], options: { grokNeoEnabled: boolean }) => unknown> {
  const module: unknown = await import(join(REPO_ROOT, "node_modules/@code-yeongyu/senpi/dist/cli/args.js"))
  const parse: unknown = Reflect.get(Object(module), "parseArgs")
  if (typeof parse !== "function") throw new Error("the installed engine exports no parseArgs from dist/cli/args.js")
  return (argv, options) => Reflect.apply(parse, undefined, [argv, options])
}
