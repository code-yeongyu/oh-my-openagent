// Guards of the computer-use v3 clean reimplementation (plan row 2).
//
// Every sub-command exits 0 on pass and 1 with one line per finding on fail; a malformed input file, a bad
// plan line or a git failure is a finding too, so no guard can pass without having scanned. Usage errors
// exit 2. The name map, shared-append list, removal inventory, legacy-name exclusions and generated-file
// list live in computer-v3-name-map.json; the plan file is read only by --scope, and only for write scopes
// and Blocked-by lines.
//
//   --residue                          no old name outside the exclusions, no class A or class B path
//   --no-legacy-edge                   the new directories never name or point into the old family
//   --copy <ref>                       no new implementation source is a rename or copy of an old one
//   --scope <row> <ref> --plan <file>  every changed path is one the row may change (Executor contract item 5)
//   --old-frozen <ref>                 no change under the 17 old directories
//   --parity [--final]                 parity-manifest statuses; --final also refuses pending rows and owed legs
//   --oracle                           imported fixtures unchanged, new cases v3-, ORACLE-DELTAS lines valid
//   --stubs                            no unimplemented!, todo!(, .skip(, .only( or bare #[ignore] in new sources

import { existsSync, lstatSync, readFileSync } from "node:fs"
import { dirname, join, posix, resolve } from "node:path"

import nameMap from "./computer-v3-name-map.json"

export type GuardResult = {
  readonly exitCode: number
  readonly findings: readonly string[]
}

export type GuardOptions = {
  readonly cwd: string
  readonly env?: Readonly<Record<string, string | undefined>>
}

/** An input the guard cannot read the way the plan defines it; reported as one finding with exit 1. */
class GuardInputError extends Error {}

// ---------------------------------------------------------------------------------------------------------
// path patterns: the write-scope grammar of the plan's Executor contract, item 5

function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]*)\}/.exec(pattern)
  if (!match) return [pattern]
  const head = pattern.slice(0, match.index)
  const tail = pattern.slice(match.index + match[0].length)
  return match[1].split(",").flatMap((option) => expandBraces(`${head}${option}${tail}`))
}

function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .replace(/[.+?^$()|[\]\\]/g, "\\$&")
    .replace(/<pr>/g, "\\d+")
    .replace(/\*\*\//g, "\0DEEP\0")
    .replace(/\*\*/g, "\0ANY\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0DEEP\0/g, "(?:.*/)?")
    .replace(/\0ANY\0/g, ".*")
  return new RegExp(`^${body}${pattern.endsWith("/") ? ".*" : ""}$`)
}

type Matcher = (path: string) => boolean

function matcher(patterns: readonly string[]): Matcher {
  const regexps = patterns.flatMap(expandBraces).map(globToRegExp)
  return (path) => regexps.some((regexp) => regexp.test(path))
}

const isLegacyNameExcluded = matcher(nameMap.legacyNameExclusions)
const isUnderNewDirectory = matcher(nameMap.newDirectories)
const isUnderOldDirectory: Matcher = (path) =>
  nameMap.oldDirectories.some((directory) => path === directory || path.startsWith(`${directory}/`))
const newDirectoryPathspecs = nameMap.newDirectories.map((directory) => directory.replace(/\/$/, ""))

/** The patterns of a plan row's `Write scope:` line; notes and entries outside this repository are dropped. */
export function parseWriteScope(line: string): readonly string[] {
  const body = line.replace(/^\s*Write scope:\s*/, "")
  const entries: string[] = []
  let depth = 0
  let current = ""
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char === "(") depth += 1
    if (char === ")") depth -= 1
    if (depth < 0) throw new GuardInputError(`Write scope has an unbalanced ')' in: ${line.trim()}`)
    if (depth === 0 && body.startsWith("; ", index)) {
      entries.push(current)
      current = ""
      index += 1
      continue
    }
    current += char
  }
  if (depth !== 0) throw new GuardInputError(`Write scope has an unbalanced '(' in: ${line.trim()}`)
  entries.push(current)
  const { outsideRepositoryPrefixes, outsideRepositoryInfix } = nameMap.scope
  return entries
    .map((entry) => entry.trim())
    .map((entry) => {
      if (entry.length < 2 || !entry.startsWith("`") || !entry.endsWith("`"))
        throw new GuardInputError(`Write scope entry is not backtick-quoted: ${entry}`)
      return entry.slice(1, -1)
    })
    .filter(
      (entry) =>
        !outsideRepositoryPrefixes.some((prefix) => entry.startsWith(prefix)) &&
        !entry.includes(outsideRepositoryInfix),
    )
    .map((entry) => (entry.includes(" (") ? entry.slice(0, entry.indexOf(" (")) : entry))
}

// ---------------------------------------------------------------------------------------------------------
// git: every guard reads the live repository; nothing is cached between runs

/** The output lines of one git call; empty lines are dropped unless `keepEmpty` (physical lines of a file). */
type Git = (args: readonly string[], allowedExitCodes?: readonly number[], keepEmpty?: boolean) => string[]

function gitIn(cwd: string, env: Readonly<Record<string, string | undefined>>): Git {
  return (args, allowedExitCodes = [0], keepEmpty = false) => {
    const result = Bun.spawnSync(["git", "-c", "core.quotePath=false", ...args], {
      cwd,
      env: { ...env },
      stdout: "pipe",
      stderr: "pipe",
    })
    if (!allowedExitCodes.includes(result.exitCode))
      throw new GuardInputError(`git ${args.join(" ")} failed (${result.exitCode}): ${result.stderr.toString().trim()}`)
    const lines = result.stdout.toString().split("\n")
    if (lines.at(-1) === "") lines.pop()
    return keepEmpty ? lines : lines.filter((line) => line.length > 0)
  }
}

/** Tracked and untracked-not-ignored files under the pathspecs. */
const listFiles = (git: Git, pathspecs: readonly string[]): string[] =>
  git(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...pathspecs])

const grepOldName = (git: Git, pathspecs: readonly string[]): string[] =>
  git(["grep", "-n", "-I", "-i", "--untracked", "-E", nameMap.oldNamePattern, "--", ...pathspecs], [0, 1]).filter(
    (line) => !isLegacyNameExcluded(line.slice(0, line.indexOf(":"))),
  )

/** `<status>\t<path>` per changed path of `<ref>...HEAD`; a rename counts as a deletion plus an addition. */
const changedPaths = (git: Git, ref: string): { readonly status: string; readonly path: string }[] =>
  git(["diff", "--no-renames", "--name-status", `${ref}...HEAD`]).map((line) => {
    const [status, path] = line.split("\t")
    return { status, path }
  })

/** The text of an input file: undefined when it is absent, a finding when it exists but cannot be read (a directory, no permission). */
function readInput(absolute: string, label: string): string | undefined {
  if (!existsSync(absolute)) return undefined
  try {
    return readFileSync(absolute, "utf8")
  } catch (error) {
    throw new GuardInputError(
      `${label} cannot be read (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
    )
  }
}

const readText = (cwd: string, path: string): string | undefined => readInput(join(cwd, path), path)

// ---------------------------------------------------------------------------------------------------------
// --residue, --no-legacy-edge, --copy, --old-frozen, --stubs

function residue(git: Git, cwd: string): string[] {
  const findings = grepOldName(git, ["."]).map((line) => `residue: ${line}`)
  // Absent means absent on disk: an empty directory, one holding only ignored files, or a dangling symlink is still
  // there. lstat sees the entry itself; existsSync follows a symlink and calls a dangling one absent.
  const remaining = [...nameMap.removal.classA, ...nameMap.removal.classB.map((entry) => entry.path)].filter(
    (path) => lstatSync(join(cwd, path), { throwIfNoEntry: false }) !== undefined,
  )
  findings.push(...remaining.map((path) => `residue: ${path} still exists`))
  // Path names: every tracked file and every untracked one on disk, ignored included; a remaining removal path is reported once above.
  const oldName = new RegExp(nameMap.oldNamePattern, "i")
  const isRemaining = (path: string): boolean => remaining.some((root) => path === root || path.startsWith(`${root}/`))
  for (const path of new Set(git(["ls-files", "--cached", "--others"]))) {
    if (oldName.test(path) && !isLegacyNameExcluded(path) && !isRemaining(path))
      findings.push(`residue: path ${path} names the old family`)
  }
  return findings
}

function noLegacyEdge(git: Git, cwd: string): string[] {
  const findings = grepOldName(git, newDirectoryPathspecs).map((line) => `no-legacy-edge: ${line}`)
  const manifests = listFiles(git, newDirectoryPathspecs).filter((path) =>
    ["Cargo.toml", "package.json"].includes(posix.basename(path)),
  )
  for (const file of manifests) {
    const content = readText(cwd, file) ?? ""
    for (const match of content.matchAll(/(?:path\s*=\s*"|"(?:file|link):)([^"]+)"/g)) {
      const target = posix.normalize(posix.join(posix.dirname(file), match[1]))
      if (isUnderOldDirectory(target))
        findings.push(`no-legacy-edge: ${file} points at ${match[1]} (${target}, an old directory)`)
    }
  }
  return findings
}

function copy(git: Git, ref: string): string[] {
  const [mergeBase] = git(["merge-base", ref, "HEAD"])
  const { similarity, sourceExtensions, dataDirectories, skipSuffixes, minLines } = nameMap.copy
  const isData = matcher(dataDirectories.map((directory) => `**/${directory}/`))
  const diff = git([
    "diff",
    "-l0",
    `-M${similarity}%`,
    `-C${similarity}%`,
    "--find-copies-harder",
    "--diff-filter=RC",
    "--name-status",
    mergeBase,
    "HEAD",
    "--",
    ...nameMap.oldDirectories,
    ...newDirectoryPathspecs,
  ])
  const findings: string[] = []
  for (const line of diff) {
    const [status, source, destination] = line.split("\t")
    if (!isUnderOldDirectory(source) || !isUnderNewDirectory(destination)) continue
    if (
      !sourceExtensions.includes(posix.extname(destination)) ||
      skipSuffixes.some((suffix) => destination.endsWith(suffix)) ||
      isData(destination)
    )
      continue
    if (git(["show", `HEAD:${destination}`], [0], true).length < minLines) continue
    findings.push(
      `copy: ${destination} is a ${status.startsWith("R") ? "rename" : "copy"} (${status.slice(1)}%) of ${source}`,
    )
  }
  return findings
}

const oldFrozen = (git: Git, ref: string): string[] =>
  changedPaths(git, ref)
    .filter(({ path }) => isUnderOldDirectory(path))
    .map(({ path }) => `old-frozen: ${path}`)

/**
 * The top-level comma-separated items inside the parentheses that open at `open`, read across lines with balanced
 * parentheses and string literals skipped; undefined when the parentheses never close.
 */
function parenthesizedItems(text: string, open: number): string[] | undefined {
  const items: string[] = []
  let depth = 0
  let start = open + 1
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      for (index += 1; index < text.length && text[index] !== '"'; index += 1) if (text[index] === "\\") index += 1
    } else if (char === "(") {
      depth += 1
    } else if (char === ")" && --depth === 0) {
      return [...items, text.slice(start, index)]
    } else if (char === "," && depth === 1) {
      items.push(text.slice(start, index))
      start = index + 1
    }
  }
  return undefined
}

/** Every `cfg_attr(<condition>, <attributes>)` whose attribute list holds `ignore` in any form, at the line where it opens. */
function cfgAttrIgnores(text: string): { readonly line: number; readonly problem: string }[] {
  const found: { readonly line: number; readonly problem: string }[] = []
  for (const match of text.matchAll(/\bcfg_attr\s*\(/g)) {
    const line = text.slice(0, match.index).split("\n").length
    const items = parenthesizedItems(text, match.index + match[0].length - 1)
    if (items === undefined) found.push({ line, problem: "unterminated cfg_attr" })
    else if (items.slice(1).some((item) => /^ignore\b/.test(item.trim())))
      found.push({ line, problem: nameMap.stubs.cfgAttrIgnore })
  }
  return found
}

function stubs(git: Git, cwd: string): string[] {
  const patterns = nameMap.stubs.patterns.map(({ name, regexp }) => ({ name, regexp: new RegExp(regexp) }))
  const findings: string[] = []
  // Every file under the new directories, whatever its extension.
  for (const file of listFiles(git, newDirectoryPathspecs)) {
    const text = readText(cwd, file) ?? ""
    text.split("\n").forEach((line, index) => {
      for (const { name, regexp } of patterns)
        if (regexp.test(line)) findings.push(`stubs: ${file}:${index + 1}: ${name}`)
    })
    findings.push(...cfgAttrIgnores(text).map(({ line, problem }) => `stubs: ${file}:${line}: ${problem}`))
  }
  return findings
}

// ---------------------------------------------------------------------------------------------------------
// --scope

type PlanRow = { readonly scope: readonly string[]; readonly blockedBy: readonly string[] }

function planRow(lines: readonly string[], row: string): PlanRow {
  const start = lines.findIndex(
    (line) =>
      line.startsWith(`- [ ] ${row}. `) || line.startsWith(`- [x] ${row}. `) || line.startsWith(`- [~] ${row}. `),
  )
  if (start < 0) throw new GuardInputError(`the plan has no row ${row}`)
  let scopeLine: string | undefined
  let blockedLine: string | undefined
  for (let index = start + 1; index < lines.length && !/^- \[[ x~]\] \d+\. |^## /.test(lines[index]); index += 1) {
    if (lines[index].startsWith("  Write scope: ")) scopeLine = lines[index]
    if (lines[index].startsWith("  Parallelization: ")) blockedLine = lines[index]
  }
  if (scopeLine === undefined) throw new GuardInputError(`row ${row} has no 'Write scope:' line`)
  const blocked = /\| Blocked by: ([^|]*?) \|/.exec(blockedLine ?? "")
  if (!blocked || !/^(?:-|\d+(?:, \d+)*)$/.test(blocked[1]))
    throw new GuardInputError(`row ${row} has no well-formed 'Blocked by:' list`)
  const removal = nameMap.removal
  const scope = parseWriteScope(scopeLine).flatMap((entry) =>
    entry === nameMap.scope.removalInventoryEntry
      ? [
          ...removal.classA.map((path) => `${path}/`),
          ...removal.classB.flatMap(({ path }) => [path, `${path}/`]),
          ...removal.classC,
          ...removal.classD,
        ]
      : [entry],
  )
  return { scope, blockedBy: blocked[1] === "-" ? [] : blocked[1].split(", ") }
}

function transitiveBlockers(lines: readonly string[], row: string): Map<string, PlanRow> {
  const blockers = new Map<string, PlanRow>()
  const queue = [...planRow(lines, row).blockedBy]
  while (queue.length > 0) {
    const next = queue.shift() ?? ""
    if (blockers.has(next)) continue
    const parsed = planRow(lines, next)
    blockers.set(next, parsed)
    queue.push(...parsed.blockedBy)
  }
  return blockers
}

/** Wiring and call-path files of every unit (`crates|packages/omo-computer-<x>/`) one of the row's entries falls under. */
function unitFiles(scope: readonly string[]): string[] {
  const { unitRoot, wiringFiles, crateWiringFiles, callPathFiles } = nameMap.scope
  const roots = new Set(scope.flatMap(expandBraces).flatMap((pattern) => new RegExp(unitRoot).exec(pattern)?.[1] ?? []))
  const files: string[] = []
  for (const root of roots) {
    files.push(...wiringFiles.map((file) => `${root}${file}`))
    if (root.startsWith("crates/")) files.push(...crateWiringFiles)
    for (const [unit, paths] of Object.entries(callPathFiles))
      if (globToRegExp(unit).test(root)) files.push(...paths.map((file) => `${root}${file}`))
  }
  return files
}

function blockerEdits(planFile: string, row: string): Set<string> {
  const file = join(dirname(planFile), nameMap.scope.blockerEdits.replace("<row>", row))
  const content = readInput(file, `blocker-edits file ${file}`)
  if (content === undefined) return new Set()
  const listed = new Set<string>()
  content.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) return
    const [path, reason] = line.split("\t")
    if (!path || /\s/.test(path) || !reason?.trim())
      throw new GuardInputError(
        `${posix.basename(file)} line ${index + 1} is malformed (expected <path><TAB><sentence>)`,
      )
    listed.add(path)
  })
  return listed
}

function scope(git: Git, row: string, ref: string, planFile: string): string[] {
  const text = readInput(planFile, `plan file ${planFile}`)
  if (text === undefined) throw new GuardInputError(`plan file ${planFile} does not exist`)
  const lines = text.split("\n")
  const own = planRow(lines, row)
  const blockers = transitiveBlockers(lines, row)
  const listed = blockerEdits(planFile, row)
  const { sharedAppend, sharedAppendNewFilesOnly, generated, driverEntryFiles } = nameMap.scope
  const isOwn = matcher([...own.scope, ...sharedAppend, ...unitFiles(own.scope), ...generated])
  const isNewFileRule = matcher(sharedAppendNewFilesOnly)
  const isBlockerOwned = matcher([...blockers.values()].flatMap(({ scope: patterns }) => patterns))
  const isDriverEntry = matcher(driverEntryFiles)
  return changedPaths(git, ref)
    .filter(({ status, path }) => {
      if (isOwn(path) || (status === "A" && isNewFileRule(path))) return false
      // A listed blocker path never admits a QA driver entry file or an existing scenario or v3- case (they are only ever added).
      return !(listed.has(path) && isBlockerOwned(path) && !isDriverEntry(path) && !isNewFileRule(path))
    })
    .map(({ path }) => `scope: ${path} is outside row ${row}'s write scope`)
}

// ---------------------------------------------------------------------------------------------------------
// --parity

type TsvRead = {
  readonly missing: boolean
  readonly problems: readonly string[]
  /** Data rows from line 2 on; a row with the wrong column count has no cells. */
  readonly rows: readonly { readonly line: number; readonly cells: string[] }[]
}

/** Reads a ledger whose line 1 must be exactly the header the name map lists; an empty file or another line 1 is a finding. */
function tsvRows(cwd: string, path: string, columns: readonly string[], label: string): TsvRead {
  const content = readText(cwd, path)
  const header = `"${columns.join(", ")}" (tab-separated)`
  if (content === undefined) return { missing: true, problems: [`${label}: ${path} is missing`], rows: [] }
  if (content.trim().length === 0)
    return { missing: false, problems: [`${label}: ${path} is empty (expected the header ${header})`], rows: [] }
  const lines = content.split("\n")
  const problems = lines[0] === columns.join("\t") ? [] : [`${label}: ${path} line 1 is not the header ${header}`]
  const rows = lines
    .map((text, index) => ({ line: index + 1, cells: text.split("\t") }))
    .slice(1)
    .filter(({ cells }) => cells.join("").trim().length > 0)
    .map((row) => (row.cells.length === columns.length ? row : { line: row.line, cells: [] }))
  return { missing: false, problems, rows }
}

const PARITY_STATUS = /^(?:pending|ported:\S.*|superseded:AC-\d+|dropped:\S.*)$/

function parity(cwd: string, final: boolean): string[] {
  const { manifest, manifestColumns, deferredLegs, deferredLegsColumns, finalGateRow } = nameMap.parity
  const read = tsvRows(cwd, manifest, manifestColumns, "parity")
  const findings: string[] = [...read.problems]
  for (const { line, cells } of read.rows) {
    const [, , testId, status] = cells
    if (cells.length === 0)
      findings.push(
        `parity: ${manifest} line ${line} is malformed (expected ${manifestColumns.length} tab-separated columns)`,
      )
    else if (!PARITY_STATUS.test(status)) findings.push(`parity: ${testId} has status "${status}" (line ${line})`)
    else if (final && status === "pending") findings.push(`parity: ${testId} is still pending (line ${line})`)
  }
  if (!final) return findings
  const legs = tsvRows(cwd, deferredLegs, deferredLegsColumns, "parity")
  findings.push(...legs.problems)
  for (const { line, cells } of legs.rows) {
    const [designRow, , recordedBy, owedTo, status] = cells
    if (
      cells.length === 0 ||
      !/^\d+$/.test(recordedBy) ||
      !/^\d+$/.test(owedTo) ||
      !/^(?:owed|passed:\S+)$/.test(status)
    ) {
      findings.push(`parity: DEFERRED-LEGS line ${line} is malformed`)
    } else if (status === "owed" && Number(owedTo) <= finalGateRow) {
      findings.push(`parity: DEFERRED-LEGS ${designRow} is still owed to row ${owedTo}`)
    }
  }
  return findings
}

// ---------------------------------------------------------------------------------------------------------
// --oracle

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Every member pointer of a JSON value with the value found there. */
function members(
  value: Json,
  prefix: readonly string[] = [],
): { readonly segments: readonly string[]; readonly value: Json }[] {
  const children: [string, Json][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : value !== null && typeof value === "object"
      ? Object.entries(value)
      : []
  return children.flatMap(([key, child]) => [
    { segments: [...prefix, key], value: child },
    ...members(child, [...prefix, key]),
  ])
}

function pointerMatches(pattern: string, segments: readonly string[]): boolean {
  const parts = pattern
    .split("/")
    .slice(1)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
  const anyPrefix = parts[0] === "**"
  const tail = anyPrefix ? parts.slice(1) : parts
  if (anyPrefix ? segments.length < tail.length : segments.length !== tail.length) return false
  const candidate = segments.slice(segments.length - tail.length)
  return tail.every((part, index) => part === "*" || part === candidate[index])
}

const toPointer = (segments: readonly string[]): string =>
  `/${segments.map((segment) => segment.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`

/** The expected messages of an imported case: `steps[].expect[].message`. */
function expectations(document: Json): Json[] {
  if (document === null || typeof document !== "object" || Array.isArray(document) || !Array.isArray(document.steps))
    return []
  return document.steps
    .flatMap((step) =>
      step !== null && typeof step === "object" && !Array.isArray(step) && Array.isArray(step.expect)
        ? step.expect
        : [],
    )
    .flatMap((expected) =>
      expected !== null && typeof expected === "object" && !Array.isArray(expected) && "message" in expected
        ? [expected.message]
        : [],
    )
}

function opensObjectReportMode(document: Json): boolean {
  if (document === null || typeof document !== "object" || Array.isArray(document) || !Array.isArray(document.steps))
    return false
  return document.steps.some(
    (step) =>
      JSON.stringify(step).includes('"method":"session.open"') && /"reportMode":"object"/.test(JSON.stringify(step)),
  )
}

function parseJson(text: string): Json | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function checkDelta(cells: readonly string[], imported: ReadonlyMap<string, Json>): string | undefined {
  const [file, pointer, kind, source, row, importedValue, v3Value] = cells
  const { parametersFixture, nullModeCases } = nameMap.oracle
  if (file !== "*" && !imported.has(file)) return `file ${file} is neither "*" nor a file of the provenance manifest`
  if (
    !pointer.startsWith("/") ||
    pointer
      .split("/")
      .slice(2)
      .some((part) => part.includes("**"))
  )
    return `pointer ${pointer} is not a pointer pattern`
  if (!source.trim() || !/^[1-9]\d*$/.test(row)) return "needs a source and a row number"
  const cases = file === "*" ? [...imported.values()] : [imported.get(file) ?? null]
  const listedMembers = cases
    .flatMap(expectations)
    .flatMap((message) => members(message))
    .filter(({ segments }) => pointerMatches(pointer, segments))
  if (kind === "additive") {
    if (importedValue || v3Value) return "an additive line carries no values"
    return listedMembers.length > 0
      ? `additive pointer ${pointer} matches ${toPointer(listedMembers[0].segments)}, which an imported expectation lists`
      : undefined
  }
  if (kind === "reworded") {
    if (importedValue || v3Value) return "a reworded line carries no values"
    const described = members(imported.get(parametersFixture) ?? null).filter(({ segments }) =>
      pointerMatches(pointer, segments),
    )
    const ok =
      file === parametersFixture &&
      described.length > 0 &&
      described.every(({ segments, value }) => segments.at(-1) === "description" && typeof value === "string")
    return ok ? undefined : `reworded pointer ${pointer} is not a description string of ${parametersFixture}`
  }
  if (kind !== "replaced") return `kind ${kind} is not additive, reworded or replaced`
  if (file === "*" || matcher(nullModeCases)(file) || !opensObjectReportMode(imported.get(file) ?? null))
    return `replaced line in ${file}, which does not open reportMode:"object"`
  if (!/\bAC-\d+\b/.test(source)) return `replaced line cites ${source}, not a contract criterion (AC-<n>)`
  const [was, now] = [parseJson(importedValue ?? ""), parseJson(v3Value ?? "")]
  if (was === undefined || now === undefined) return "replaced line needs a JSON imported value and a JSON v3 value"
  if (JSON.stringify(was) === JSON.stringify(now)) return "replaced line keeps the imported value"
  if (listedMembers.length === 0)
    return `replaced pointer ${pointer} is not listed by an imported expectation of ${file}`
  const wrong = listedMembers.find(({ value }) => JSON.stringify(value) !== JSON.stringify(was))
  return wrong
    ? `replaced line names ${importedValue}, but ${file} lists ${JSON.stringify(wrong.value)} at ${toPointer(wrong.segments)}`
    : undefined
}

function oracle(git: Git, cwd: string): string[] {
  const { provenance, provenanceColumns, deltas, deltasColumns, directories, newCasePrefix } = nameMap.oracle
  const read = tsvRows(cwd, provenance, provenanceColumns, "oracle")
  if (read.missing) return [...read.problems]
  const findings: string[] = [...read.problems]
  const imported = new Map<string, Json>()
  for (const { line, cells } of read.rows) {
    const [path, , , , expectedSha] = cells
    if (cells.length === 0 || !/^[0-9a-f]{64}$/.test(expectedSha)) {
      findings.push(`oracle: ${provenance} line ${line} is malformed`)
      continue
    }
    const content = readText(cwd, path)
    if (content === undefined) {
      findings.push(`oracle: ${path} is listed in the provenance manifest but missing`)
      continue
    }
    const actualSha = new Bun.CryptoHasher("sha256").update(content).digest("hex")
    if (actualSha !== expectedSha)
      findings.push(`oracle: ${path} differs from its provenance row (${actualSha} != ${expectedSha})`)
    imported.set(path, parseJson(content) ?? null)
  }
  for (const file of listFiles(git, [
    ...new Set([...directories, ...[...imported.keys()].map((path) => `${posix.dirname(path)}/`)]),
  ])) {
    if (!imported.has(file) && !posix.basename(file).startsWith(newCasePrefix))
      findings.push(
        `oracle: ${file} is not in the provenance manifest and its name does not start with ${newCasePrefix}`,
      )
  }
  const deltaRead = tsvRows(cwd, deltas, deltasColumns, "oracle")
  findings.push(...deltaRead.problems)
  for (const { line, cells } of deltaRead.rows) {
    const problem =
      cells.length === 0 ? `expected ${deltasColumns.length} tab-separated columns` : checkDelta(cells, imported)
    if (problem) findings.push(`oracle: ORACLE-DELTAS line ${line}: ${problem}`)
  }
  return findings
}

// ---------------------------------------------------------------------------------------------------------
// entry

const USAGE = [
  "usage: bun script/computer-v3-guards.ts <sub-command>",
  "  --residue | --no-legacy-edge | --copy <ref> | --scope <row> <ref> --plan <file> | --old-frozen <ref> | --parity [--final] | --oracle | --stubs",
].join("\n")

function dispatch(args: readonly string[], cwd: string, git: Git): (() => string[]) | undefined {
  const [command, ...rest] = args
  const one = rest.length === 1 ? rest[0] : undefined
  if (command === "--residue" && rest.length === 0) return () => residue(git, cwd)
  if (command === "--no-legacy-edge" && rest.length === 0) return () => noLegacyEdge(git, cwd)
  if (command === "--copy" && one) return () => copy(git, one)
  if (command === "--old-frozen" && one) return () => oldFrozen(git, one)
  if (command === "--oracle" && rest.length === 0) return () => oracle(git, cwd)
  if (command === "--stubs" && rest.length === 0) return () => stubs(git, cwd)
  if (command === "--parity" && (rest.length === 0 || (rest.length === 1 && rest[0] === "--final")))
    return () => parity(cwd, rest[0] === "--final")
  const [row, ref, planFlag, planFile] = rest
  if (command === "--scope" && rest.length === 4 && /^\d+$/.test(row) && planFlag === "--plan")
    return () => scope(git, row, ref, resolve(cwd, planFile))
  return undefined
}

export function runGuard(args: readonly string[], options: GuardOptions): GuardResult {
  const run = dispatch(args, options.cwd, gitIn(options.cwd, options.env ?? process.env))
  if (run === undefined) return { exitCode: 2, findings: [] }
  try {
    const findings = run()
    return { exitCode: findings.length === 0 ? 0 : 1, findings }
  } catch (error) {
    if (!(error instanceof GuardInputError)) throw error
    return { exitCode: 1, findings: [`${args[0].slice(2)}: ${error.message}`] }
  }
}

if (import.meta.main) {
  const result = runGuard(process.argv.slice(2), { cwd: process.cwd() })
  if (result.exitCode === 2) console.error(USAGE)
  for (const finding of result.findings) console.log(finding)
  process.exit(result.exitCode)
}
