import { parseRich } from "../../adapter/rich"
import type { GateOp, OutboundIntent } from "./types"

type TextField = "text" | "comment" | "root" | "name"

function textFieldOf(op: GateOp): TextField | null {
  switch (op.op) {
    case "post":
    case "edit":
      return "text"
    case "upload":
      return op.comment === null ? null : "comment"
    case "open_thread":
      return "root"
    case "create_chat":
      return "name"
    case "react":
    case "unreact":
    case "typing":
    case "archive_thread":
    case "reopen_thread":
      return null
  }
}

export function opText(op: GateOp): string | null {
  const field = textFieldOf(op)
  if (field === null) return null
  const value: unknown = Reflect.get(op, field)
  return typeof value === "string" ? value : null
}

export function withOpText(op: GateOp, text: string): GateOp {
  const field = textFieldOf(op)
  return field === null ? op : { ...op, [field]: text }
}

export function textsOf(intent: OutboundIntent): readonly string[] {
  return intent.ops.flatMap((op) => {
    const text = opText(op)
    return text === null ? [] : [text]
  })
}

export async function rewriteTexts(
  intent: OutboundIntent,
  rewrite: (text: string, op: GateOp) => string | Promise<string>,
): Promise<OutboundIntent | null> {
  let changed = false
  const ops: GateOp[] = []
  for (const op of intent.ops) {
    const text = opText(op)
    if (text === null) {
      ops.push(op)
      continue
    }
    const next = await rewrite(text, op)
    if (next !== text) changed = true
    ops.push(withOpText(op, next))
  }
  return changed ? { ...intent, ops } : null
}

/**
 * The words a reader sees: text nodes and link labels. Link targets and mention/channel displays
 * are excluded (the platform renders a mention with the user's own name, not ours).
 */
export function proseOf(markup: string): string {
  return parseRich(markup)
    .map((node) => (node.t === "text" ? node.text : node.t === "link" ? node.label : " "))
    .join("")
}

export const SCRIPT_NAMES = [
  "Latin", "Hangul", "Han", "Hiragana", "Katakana", "Cyrillic", "Greek", "Arabic", "Hebrew", "Thai", "Devanagari",
] as const
export type ScriptName = (typeof SCRIPT_NAMES)[number] | "Other"

const SCRIPT_RES: Readonly<Record<(typeof SCRIPT_NAMES)[number], RegExp>> = {
  Latin: /\p{Script=Latin}/u,
  Hangul: /\p{Script=Hangul}/u,
  Han: /\p{Script=Han}/u,
  Hiragana: /\p{Script=Hiragana}/u,
  Katakana: /\p{Script=Katakana}/u,
  Cyrillic: /\p{Script=Cyrillic}/u,
  Greek: /\p{Script=Greek}/u,
  Arabic: /\p{Script=Arabic}/u,
  Hebrew: /\p{Script=Hebrew}/u,
  Thai: /\p{Script=Thai}/u,
  Devanagari: /\p{Script=Devanagari}/u,
}

const LETTER = /\p{L}/u

export function scriptOf(char: string): ScriptName {
  for (const name of SCRIPT_NAMES) if (SCRIPT_RES[name].test(char)) return name
  return "Other"
}

export interface LetterHit {
  readonly script: ScriptName
  readonly index: number
}

export function letters(text: string): LetterHit[] {
  const hits: LetterHit[] = []
  let index = 0
  for (const char of text) {
    if (LETTER.test(char)) hits.push({ script: scriptOf(char), index })
    index += char.length
  }
  return hits
}

const LATIN_LANGUAGES = [
  "en", "de", "fr", "es", "it", "pt", "nl", "sv", "da", "no", "nb", "nn", "fi", "pl", "cs", "sk", "tr", "vi",
  "id", "ms", "ro", "hu", "hr", "sl", "et", "lv", "lt", "ca", "eu", "ga", "is", "tl", "sw",
] as const

const LANGUAGE_SCRIPTS: Readonly<Record<string, readonly ScriptName[]>> = {
  ...Object.fromEntries(LATIN_LANGUAGES.map((tag) => [tag, ["Latin"]])),
  ko: ["Hangul", "Han"],
  ja: ["Hiragana", "Katakana", "Han"],
  zh: ["Han"],
  ru: ["Cyrillic"], uk: ["Cyrillic"], bg: ["Cyrillic"], sr: ["Cyrillic", "Latin"], be: ["Cyrillic"], kk: ["Cyrillic"],
  el: ["Greek"],
  ar: ["Arabic"], fa: ["Arabic"], ur: ["Arabic"],
  he: ["Hebrew"],
  th: ["Thai"],
  hi: ["Devanagari"], mr: ["Devanagari"], ne: ["Devanagari"],
}

/** Scripts a language tag is written in (`en-US` -> `en`), or null for a tag this table does not know. */
export function scriptsForLanguage(tag: string): readonly ScriptName[] | null {
  const base = tag.trim().toLowerCase().split(/[-_]/)[0] ?? ""
  return LANGUAGE_SCRIPTS[base] ?? null
}

const SCRIPT_LANGUAGE: Partial<Record<ScriptName, string>> = {
  Latin: "a Latin-script language", Hangul: "Korean", Hiragana: "Japanese", Katakana: "Japanese", Han: "Chinese",
  Cyrillic: "a Cyrillic-script language", Greek: "Greek", Arabic: "an Arabic-script language", Hebrew: "Hebrew",
  Thai: "Thai", Devanagari: "a Devanagari-script language",
}

export function describeScript(script: ScriptName): string {
  return SCRIPT_LANGUAGE[script] ?? "another script"
}

export type WritingSystem = "Latin" | "Hangul" | "Japanese" | "Han" | ScriptName

function writingSystemOf(script: ScriptName, hasKana: boolean): WritingSystem {
  if (script === "Hiragana" || script === "Katakana") return "Japanese"
  if (script === "Han" && hasKana) return "Japanese"
  return script
}

/**
 * Weight of each writing system in a text. One CJK or Hangul character carries about a syllable,
 * so it weighs three Latin letters.
 */
export function writingSystemWeights(text: string): ReadonlyMap<WritingSystem, number> {
  const hits = letters(text)
  const hasKana = hits.some((hit) => hit.script === "Hiragana" || hit.script === "Katakana")
  const weights = new Map<WritingSystem, number>()
  for (const hit of hits) {
    const system = writingSystemOf(hit.script, hasKana)
    const weight = system === "Latin" || system === "Cyrillic" || system === "Greek" ? 1 : 3
    weights.set(system, (weights.get(system) ?? 0) + weight)
  }
  return weights
}

export function dominantWritingSystem(text: string): WritingSystem | null {
  let best: WritingSystem | null = null
  let bestWeight = 0
  for (const [system, weight] of writingSystemWeights(text)) {
    if (weight > bestWeight) {
      best = system
      bestWeight = weight
    }
  }
  return best
}

/** Share (0..1) of a text's letter weight written in `system`; 0 for a text without letters. */
export function writingSystemShare(text: string, system: WritingSystem): number {
  const weights = writingSystemWeights(text)
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0)
  return total === 0 ? 0 : (weights.get(system) ?? 0) / total
}

export function sampleAround(text: string, index: number): string {
  return text.slice(Math.max(0, index - 20), index + 20).replace(/\s+/g, " ").trim()
}
