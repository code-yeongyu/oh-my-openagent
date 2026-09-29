// Playbook parser. A playbook is a git repo of prose rules and lessons:
//
//   rules/<file>.md             H1 title, then `### <rule in one sentence>` entries, each followed by
//                               `- Why:`, `- Enforced:`, `- Added:` and an optional `- Lesson:` bullet
//   lessons/<date>-<slug>.md    one lesson per file: H1 title, then `- What happened:`, `- Impact:`,
//                               `- Fix:` (and optional `- Rule it produced:`, `- Date:`) bullets
//
// Parsing is lenient per entry and loud about it: a missing or unknown bullet is a warning on that
// entry (the rule still imports, so a new playbook rule never needs a code change), an entry that
// has no stable identity (empty heading slug, duplicate slug in one file) is an error and is skipped.
// Every entry carries a stable `key` (`rules/<file>.md#<heading-slug>` or `lessons/<file>.md`) that
// does not depend on line numbers, so cosmetic edits never churn the imported records.

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { assignBullets, collectBullets, stripClosingHashes, unfencedLines } from "./bullets"

export const DEFAULT_PLAYBOOK_INCLUDE = ["rules/*.md", "lessons/*.md"] as const

export interface PlaybookFile {
  /** Repo-relative path with `/` separators, e.g. `rules/slack.md`. */
  readonly path: string
  readonly content: string
}

export interface PlaybookRuleEntry {
  readonly kind: "rule"
  readonly key: string
  readonly file: string
  readonly line: number
  readonly heading: string
  readonly slug: string
  readonly why?: string
  readonly enforced?: string
  readonly added?: string
  readonly lesson?: string
}

export interface PlaybookLessonEntry {
  readonly kind: "lesson"
  readonly key: string
  readonly file: string
  readonly line: number
  readonly title: string
  readonly what_happened?: string
  readonly impact?: string
  readonly fix?: string
  readonly rule_produced?: string
  readonly date?: string
}

export type PlaybookEntry = PlaybookRuleEntry | PlaybookLessonEntry

export interface PlaybookProblem {
  readonly file: string
  readonly line: number
  readonly severity: "warning" | "error"
  readonly reason: string
}

export interface ParsedPlaybook {
  readonly entries: readonly PlaybookEntry[]
  readonly problems: readonly PlaybookProblem[]
  /** Files matched by `include` that hold no entries (index files such as lessons/README.md). */
  readonly skipped: readonly { readonly file: string; readonly reason: string }[]
}

export class PlaybookError extends Error {
  override readonly name = "PlaybookError"
}

const RULE_BULLETS = { why: "why", enforced: "enforced", added: "added", lesson: "lesson" } as const
const LESSON_BULLETS = {
  "what happened": "what_happened",
  impact: "impact",
  fix: "fix",
  "rule it produced": "rule_produced",
  date: "date",
} as const
const LESSON_FILE_RE = /^\d{4}-\d{2}-\d{2}-[^/]+\.md$/

/**
 * Stable slug of a heading: lowercase, diacritics and quotes dropped, every other run of
 * non-letter/non-digit characters collapsed to one `-`. Letters of any script are kept, recomposed
 * (NFC) so a syllabic script that NFKD splits into parts yields the same slug as its composed form.
 */
export function headingSlug(heading: string): string {
  return heading
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/['\u2018\u2019"\u201c\u201d`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
}

function parseRuleFile(file: PlaybookFile, problems: PlaybookProblem[]): PlaybookRuleEntry[] {
  const lines = unfencedLines(file.content)
  const entries: PlaybookRuleEntry[] = []
  const seen = new Map<string, number>()
  let index = 0
  while (index < lines.length) {
    const start = lines[index]
    const heading = start === undefined ? null : /^###\s+(.*)$/.exec(start.text)
    if (start === undefined || heading === null) {
      index += 1
      continue
    }
    const body: { text: string; line: number }[] = []
    index += 1
    while (index < lines.length && !/^#{1,3}\s/.test(lines[index]?.text ?? "")) {
      const next = lines[index]
      if (next !== undefined) body.push(next)
      index += 1
    }
    const text = stripClosingHashes(heading[1] ?? "")
    const slug = headingSlug(text)
    if (slug === "") {
      problems.push({ file: file.path, line: start.line, severity: "error", reason: "heading has no letters or digits, so it has no stable identity; entry skipped" })
      continue
    }
    const holder = seen.get(slug)
    if (holder !== undefined) {
      problems.push({ file: file.path, line: start.line, severity: "error", reason: `heading slug '${slug}' repeats the entry at line ${holder}; entry skipped` })
      continue
    }
    seen.set(slug, start.line)
    const fields = assignBullets(collectBullets(body, file.path, problems), RULE_BULLETS, file.path, problems)
    for (const required of ["why", "enforced"] as const) {
      if (fields[required] === undefined) {
        problems.push({ file: file.path, line: start.line, severity: "warning", reason: `entry has no '- ${required === "why" ? "Why" : "Enforced"}:' bullet` })
      }
    }
    entries.push({ kind: "rule", key: `${file.path}#${slug}`, file: file.path, line: start.line, heading: text, slug, ...fields })
  }
  return entries
}

function parseLessonFile(file: PlaybookFile, problems: PlaybookProblem[]): PlaybookLessonEntry | null {
  const lines = unfencedLines(file.content)
  const titleAt = lines.findIndex(({ text }) => /^#\s+\S/.test(text))
  const titleLine = titleAt === -1 ? undefined : lines[titleAt]
  const title = titleLine === undefined ? "" : stripClosingHashes(titleLine.text.replace(/^#\s+/, ""))
  if (titleLine === undefined || title === "") {
    problems.push({ file: file.path, line: 1, severity: "error", reason: "lesson has no '# <title>' line; skipped" })
    return null
  }
  const body = lines.slice(titleAt + 1).filter(({ text }) => !/^#{1,6}\s/.test(text))
  const fields = assignBullets(collectBullets(body, file.path, problems), LESSON_BULLETS, file.path, problems)
  if (fields.fix === undefined) problems.push({ file: file.path, line: titleLine.line, severity: "warning", reason: "lesson has no '- Fix:' bullet" })
  return { kind: "lesson", key: file.path, file: file.path, line: titleLine.line, title, ...fields }
}

function isLessonPath(path: string): boolean {
  return path.split("/")[0] === "lessons"
}

export function parsePlaybook(files: readonly PlaybookFile[]): ParsedPlaybook {
  const entries: PlaybookEntry[] = []
  const problems: PlaybookProblem[] = []
  const skipped: { file: string; reason: string }[] = []
  for (const file of [...files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))) {
    const name = file.path.split("/").at(-1) ?? file.path
    if (isLessonPath(file.path)) {
      if (!LESSON_FILE_RE.test(name)) {
        skipped.push({ file: file.path, reason: "not a lesson file (expected lessons/<yyyy-mm-dd>-<slug>.md)" })
        continue
      }
      const lesson = parseLessonFile(file, problems)
      if (lesson !== null) entries.push(lesson)
      continue
    }
    const rules = parseRuleFile(file, problems)
    if (rules.length === 0 && !problems.some((problem) => problem.file === file.path && problem.severity === "error")) {
      skipped.push({ file: file.path, reason: "no '### ' entries" })
    }
    entries.push(...rules)
  }
  return { entries, problems, skipped }
}

function checkInclude(pattern: string): string {
  if (pattern.startsWith("/") || pattern.split("/").includes("..")) {
    throw new PlaybookError(`include pattern must stay inside the playbook repo: ${pattern}`)
  }
  return pattern
}

export async function readPlaybook(root: string, include: readonly string[] = DEFAULT_PLAYBOOK_INCLUDE): Promise<PlaybookFile[]> {
  const paths = new Set<string>()
  for (const pattern of include.map(checkInclude)) {
    for await (const path of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true, followSymlinks: false })) {
      paths.add(path.split("\\").join("/"))
    }
  }
  const sorted = [...paths].sort()
  return Promise.all(sorted.map(async (path) => ({ path, content: await readFile(join(root, path), "utf8") })))
}
