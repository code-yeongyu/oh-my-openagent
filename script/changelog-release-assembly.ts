/**
 * Release notes from the Unreleased section plus the fragments' CHANGELOG text (#9961, #10841).
 *
 * A fragment's text is paragraphs (`**Title.** body ([#n](...))`), `### Section` groups of `- ` bullets
 * (Keep a Changelog), or both. The release section gets the paragraphs first, newest PR first through the
 * shared assembly order, then one group per section name in first-seen order. A bullet without a link to its
 * own PR gets one, so a grouped entry still names the PR that made it.
 */
import { assembleUnreleasedBody } from "./changelog-gate-rules.ts"
import { blocksOf, linkEntry, scanFences } from "./changelog-notes-markdown.ts"

const PULL_URL = "https://github.com/code-yeongyu/oh-my-openagent/pull"
const SECTION = /^### (.+?)\s*$/

export type Notes = { readonly paragraphs: string; readonly sections: ReadonlyMap<string, readonly string[]> }

/**
 * Text before the first `### ` heading, then each heading's bullets. A bullet keeps its indented continuation lines;
 * any other text under a heading throws, so the PR check (package-log-gate.ts) refuses what the release cannot place.
 */
export function parseNotes(text: string): Notes {
  const paragraphs: string[] = []
  const sections = new Map<string, string[]>()
  let current: string[] | null = null
  for (const { text: line, fenced } of scanFences(text)) {
    const heading = fenced ? undefined : SECTION.exec(line)?.[1]
    if (heading !== undefined) {
      current = sections.get(heading) ?? []
      sections.set(heading, current)
    } else if (current === null) {
      paragraphs.push(line)
    } else if (!fenced && line.startsWith("- ")) {
      current.push(line)
    } else if (fenced || line.trim() !== "") {
      const last = current.pop()
      const blankInFence = fenced && line.trim() === ""
      if (last === undefined || (!blankInFence && !/^\s/.test(line))) throw new Error(`text under a ### heading must be a "- " bullet or an indented continuation of one: ${line}`)
      current.push(`${last}\n${line}`)
    }
  }
  return { paragraphs: paragraphs.join("\n").trim(), sections }
}

const linkBullet = (entry: string, pr: number): string => linkEntry(entry, pr, PULL_URL)

/** Every paragraph names the PR that made it (code fences untouched; see changelog-notes-markdown.ts). */
const linkParagraphs = (text: string, pr: number): string =>
  blocksOf(text).map((paragraph) => linkBullet(paragraph.trim(), pr)).join("\n\n")

/** One notes text from several, in order: their paragraphs first, then one group per section name, first seen first. */
export function mergeNotes(texts: readonly string[]): string {
  const paragraphs: string[] = []
  const groups = new Map<string, string[]>()
  for (const text of texts) {
    const notes = parseNotes(text)
    if (notes.paragraphs !== "") paragraphs.push(notes.paragraphs)
    for (const [name, bullets] of notes.sections) groups.set(name, [...(groups.get(name) ?? []), ...bullets])
  }
  const sections = [...groups].filter(([, bullets]) => bullets.length > 0).map(([name, bullets]) => `### ${name}\n\n${bullets.join("\n")}`)
  return [...paragraphs, ...sections].join("\n\n")
}

/** The notes with every paragraph and bullet that lacks a link to `pr` linked to it (a folded car keeps its credit). */
export function linkNotes(text: string, pr: number): string {
  const notes = parseNotes(text)
  const sections = [...notes.sections].map(([name, bullets]) => `### ${name}\n\n${bullets.map((bullet) => linkBullet(bullet, pr)).join("\n")}`)
  return [linkParagraphs(notes.paragraphs, pr), ...sections].filter((part) => part !== "").join("\n\n")
}

export type Assembly = { readonly body: string; readonly duplicates: readonly number[] }

/**
 * `legacy` is the Unreleased text written before the fragments gate. A fragment whose PR a legacy entry already
 * links is a second copy of that entry (a PR that wrote both while the two rules overlapped): it is consumed
 * and reported in `duplicates`, never released twice.
 */
export function assembleRelease(legacy: string, fragments: readonly { readonly pr: number; readonly content: string }[]): Assembly {
  const covered = new Set([...legacy.matchAll(/\/pull\/(\d+)\)/g)].map((match) => Number(match[1])))
  const duplicates = fragments.filter((fragment) => covered.has(fragment.pr)).map((fragment) => fragment.pr)
  const kept = [...fragments].filter((fragment) => !covered.has(fragment.pr)).sort((left, right) => right.pr - left.pr)
  const old = parseNotes(legacy)
  const parsed = kept.map((fragment) => ({ pr: fragment.pr, notes: parseNotes(fragment.content) }))
  const paragraphs = assembleUnreleasedBody(
    parsed.map(({ pr, notes }) => ({ pr, content: linkParagraphs(notes.paragraphs, pr) })).filter((entry) => entry.content !== ""),
  )
  const groups = new Map<string, string[]>()
  for (const [name, bullets] of old.sections) groups.set(name, [...bullets])
  for (const { pr, notes } of parsed) {
    for (const [name, bullets] of notes.sections) {
      groups.set(name, [...(groups.get(name) ?? []), ...bullets.map((bullet) => linkBullet(bullet, pr))])
    }
  }
  const sections = [...groups].filter(([, bullets]) => bullets.length > 0).map(([name, bullets]) => `### ${name}\n\n${bullets.join("\n")}`)
  const body = [old.paragraphs, paragraphs, ...sections].filter((part) => part !== "").join("\n\n")
  return { body, duplicates }
}
