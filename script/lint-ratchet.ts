import * as NodeChildProcess from "node:child_process"
import * as NodeFS from "node:fs"
import * as NodePath from "node:path"
import * as NodeProcess from "node:process"

import { parseSync } from "oxc-parser"

// The strictness rules every repo enforces, plus the landmines testing rules (ported from
// interfere-inc/landmines, MIT; no-module-mock extends its no-test-doubles to bun's mock.module). This repo still has hundreds of old sites, so they ratchet: each
// file's count must match the baseline exactly. A rise fails, and so does a drop until the baseline
// is lowered in the same change, so a removed site cannot come back. The old sites are rewritten
// package by package later, each reviewed as a behaviour change.
export const RATCHET_RULES = [
  "typescript/no-explicit-any",
  "typescript/ban-ts-comment",
  "typescript/no-non-null-assertion",
  "omo-testing/no-fixed-sleep",
  "omo-testing/no-flake-masking",
  "omo-testing/no-module-mock",
] as const

// A disable comment hides a finding from the linter, so it is counted as an extra value: one that
// names one of the ratcheted rules, or a bare one that turns every rule off for its line or file.
export const SUPPRESSION = "disable-directive"
// A directive is a comment whose text starts with the directive word, as oxlint reads it. The
// comments come from the parser's tokens, so a directive inside a string or template never counts.
const DIRECTIVE = /^[\s*]*(?:oxlint|eslint)-disable(?:-next-line|-line)?(?:\s|$)([\s\S]*)$/
const NAMES_A_RULE =
  /\b(?:no-explicit-any|ban-ts-comment|no-non-null-assertion|no-fixed-sleep|no-flake-masking|no-module-mock)\b/

export const countSuppressions = (file: string, source: string): number => {
  let count = 0
  for (const comment of parseSync(file, source).comments) {
    const rest = DIRECTIVE.exec(comment.value)?.[1] ?? null
    if (rest === null) continue
    const list = rest.split("--")[0]?.trim() ?? ""
    if (list === "" || NAMES_A_RULE.test(list)) count += 1
  }
  return count
}

export type Counts = Readonly<Record<string, Readonly<Record<string, number>>>>

type Diagnostic = { readonly code?: string | null; readonly filename: string; readonly message?: string }

const ruleOf = (code: string): string => code.replace(/^([a-z-]+)\(([a-z-]+)\)$/, "$1/$2")

export const countByFile = (diagnostics: readonly (Diagnostic & { readonly code: string })[], root: string): Counts => {
  const counts: Record<string, Record<string, number>> = {}
  for (const { code, filename } of diagnostics) {
    const file = NodePath.relative(root, NodePath.resolve(root, filename)).split(NodePath.sep).join("/")
    const rule = ruleOf(code)
    const perFile = (counts[file] ??= {})
    perFile[rule] = (perFile[rule] ?? 0) + 1
  }
  return counts
}

export type Change = {
  readonly file: string
  readonly rule: string
  readonly before: number
  readonly after: number
}

export const compare = (baseline: Counts, current: Counts) => {
  const increases: Change[] = []
  const decreases: Change[] = []
  const files = new Set([...Object.keys(baseline), ...Object.keys(current)])
  for (const file of [...files].toSorted()) {
    for (const rule of [...RATCHET_RULES, SUPPRESSION]) {
      const before = baseline[file]?.[rule] ?? 0
      const after = current[file]?.[rule] ?? 0
      if (after > before) increases.push({ file, rule, before, after })
      if (after < before) decreases.push({ file, rule, before, after })
    }
  }
  return { increases, decreases }
}

const sorted = (counts: Counts): Counts =>
  Object.fromEntries(
    Object.keys(counts)
      .toSorted()
      .map((file) => [
        file,
        Object.fromEntries(Object.entries(counts[file] ?? {}).toSorted(([a], [b]) => a.localeCompare(b))),
      ]),
  )

// The tracked JS/TS sources (never built bundles or vendored output), linted with only the three rules.
const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/
// Generated sources are rewritten by their generator, so their disable comments are not new code:
// protobuf-es output (`*_pb.ts`) and `*.generated.ts` files are not ratcheted. Any other file still is.
const GENERATED = /(?:_pb|\.generated)\.(?:[cm]?[jt]s|tsx)$/
export const ratchetedFiles = (files: readonly string[]): string[] =>
  files.filter((file) => SOURCE.test(file) && !GENERATED.test(file))
// #14220: minified bundle output is not a test source, but the bundler's short function names collide
// with the test API names the two omo-testing rules key on, so every bundle regeneration moved their
// counts between files (train #14196 had to hand-edit the baseline for exactly that). Bundle output
// therefore never counts for the test rules; every other rule keeps counting everywhere.
const BUNDLE_OUTPUT = /packages[/\\][^/\\]+[/\\]plugin[/\\](?:extensions|runtime)[/\\]/
export const countsTowardRatchet = (code: string, filename: string): boolean =>
  // oxlint emits plugin rules as "omo-testing(rule)" before the ratchet normalizes them to
  // "omo-testing/rule", so the namespace prefix matches both shapes.
  !(code.startsWith("omo-testing") && BUNDLE_OUTPUT.test(filename))

const CONFIG = "script/lint-ratchet.oxlintrc.json"

const run = (root: string, command: string, args: readonly string[]) =>
  NodeChildProcess.spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })

// A diagnostic with no rule code is a parse error: that file's findings cannot be counted. A file
// oxlint was given but did not lint (`skipped`) cannot be counted either.
type Lint = { readonly counts: Counts; readonly unparsed: readonly string[]; readonly skipped: number }

export const lint = (root: string): Lint => {
  const listed = run(root, "git", ["ls-files", "-z"])
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`)
  const files = ratchetedFiles(listed.stdout.split("\0"))
    // A tracked path missing on disk (an unchecked-out submodule) is not linted either.
    .filter((file) => NodeFS.existsSync(NodePath.join(root, file)))
  const diagnostics: Diagnostic[] = []
  let skipped = 0
  // Batches keep each argv under the OS limit.
  for (let start = 0; start < files.length; start += 2000) {
    const batch = files.slice(start, start + 2000)
    // --no-ignore: no .eslintignore entry, --ignore-path or --ignore-pattern may hide a file and drop
    // its counts silently. The only exclusions are ratchetedFiles and countsTowardRatchet above.
    const result = run(root, NodePath.join(root, "node_modules/.bin/oxlint"), [
      "--no-ignore",
      "-c",
      CONFIG,
      "--format",
      "json",
      ...batch,
    ])
    if (result.error !== undefined || (result.status !== 0 && result.status !== 1))
      throw new Error(`oxlint failed (status ${String(result.status)}): ${result.stderr}`)
    const parsed: { readonly diagnostics: readonly Diagnostic[]; readonly number_of_files: number } = JSON.parse(
      result.stdout,
    )
    diagnostics.push(...parsed.diagnostics)
    // --no-ignore does not reach a config's ignorePatterns, so a file oxlint skips is caught here.
    skipped += batch.length - parsed.number_of_files
  }
  const ruled = diagnostics
    .flatMap((diagnostic) => (typeof diagnostic.code === "string" ? [{ ...diagnostic, code: diagnostic.code }] : []))
    .filter((diagnostic) => countsTowardRatchet(diagnostic.code, diagnostic.filename ?? ""))
  const unparsed = diagnostics
    .filter((diagnostic) => typeof diagnostic.code !== "string")
    .map((diagnostic) => `${diagnostic.filename}: ${diagnostic.message ?? "parse error"}`)
  const counts: Record<string, Record<string, number>> = { ...countByFile(ruled, root) }
  for (const file of files) {
    const count = countSuppressions(file, NodeFS.readFileSync(NodePath.join(root, file), "utf8"))
    if (count > 0) counts[file] = { ...counts[file], [SUPPRESSION]: count }
  }
  return { counts, unparsed, skipped }
}

const main = () => {
  const root = NodePath.resolve(import.meta.dirname, "..")
  const baselinePath = NodePath.join(root, "script/lint-ratchet.baseline.json")
  const { counts: current, unparsed, skipped } = lint(root)
  if (unparsed.length > 0) {
    for (const line of unparsed) console.error(line)
    console.error("lint-ratchet: a file that fails to parse cannot be counted; fix the syntax first.")
    NodeProcess.exit(1)
  }
  if (skipped > 0) {
    console.error(
      `lint-ratchet: oxlint skipped ${skipped} file(s) it was given, so their counts would drop silently; remove the ignorePatterns entry and exclude files in the ratchet's file filter instead.`,
    )
    NodeProcess.exit(1)
  }
  if (NodeProcess.argv.includes("--update")) {
    // Lowering is the only routine update: raising a count needs the explicit flag, so following
    // the "lower the baseline" advice can never also lock in new findings.
    if (NodeFS.existsSync(baselinePath) && !NodeProcess.argv.includes("--allow-increase")) {
      const { increases } = compare(JSON.parse(NodeFS.readFileSync(baselinePath, "utf8")), current)
      for (const { file, rule, before, after } of increases)
        console.error(`${file}: ${rule} went up from ${before} to ${after}`)
      if (increases.length > 0) {
        console.error("lint-ratchet: --update only lowers counts; fix the new findings (or pass --allow-increase).")
        NodeProcess.exit(1)
      }
    }
    NodeFS.writeFileSync(baselinePath, `${JSON.stringify(sorted(current), null, 2)}\n`)
    console.log(`lint-ratchet: baseline written for ${Object.keys(current).length} files`)
    return
  }
  const baseline: Counts = JSON.parse(NodeFS.readFileSync(baselinePath, "utf8"))
  const { increases, decreases } = compare(baseline, current)
  for (const { file, rule, before, after } of increases)
    console.error(`${file}: ${rule} went up from ${before} to ${after}`)
  for (const { file, rule, before, after } of decreases)
    console.error(`${file}: ${rule} went down from ${before} to ${after}; lower the baseline in this change`)
  if (increases.length > 0)
    console.error(`lint-ratchet: new code must not add ${RATCHET_RULES.join(", ")} or a disable comment for them.`)
  if (decreases.length > 0 && increases.length === 0)
    console.error(
      "lint-ratchet: run `bun run lint:ratchet:update` and commit the baseline, so removed sites cannot come back.",
    )
  if (increases.length > 0 || decreases.length > 0) NodeProcess.exit(1)
  console.log("lint-ratchet: every count matches the baseline")
}

if (import.meta.main) main()
