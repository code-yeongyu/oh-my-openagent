import type { GcPart, MessageWithParts } from "./types"
import { parseMarkers } from "./reference-marker"

export type PrefetchCandidate = {
  brainId: number
  description: string
  score: number
}

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "can", "could", "may", "might", "must", "and", "or", "but",
  "not", "no", "for", "from", "with", "this", "that", "these", "those",
  "it", "its", "of", "in", "on", "at", "to", "by", "as", "if", "so",
  "than", "too", "very", "just", "here", "there", "how", "what", "when",
  "where", "who", "which", "why", "all", "each", "every", "some", "any",
  "few", "more", "most", "other", "into", "through", "about", "me", "my",
  "you", "your", "we", "our", "they", "them", "their", "i", "he", "she",
  "his", "her", "up", "out", "also", "then", "now", "get", "got", "let",
  "use", "used", "using", "see", "look", "tell", "show",
])

const MIN_WORD_LENGTH = 3
const MIN_SCORE = 0.4

export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(w))

  return [...new Set(words)]
}

function scoreDescription(descriptionKeywords: string[], queryKeywords: string[]): number {
  if (queryKeywords.length === 0 || descriptionKeywords.length === 0) return 0

  let matches = 0
  for (const qk of queryKeywords) {
    for (const dk of descriptionKeywords) {
      if (dk.includes(qk) || qk.includes(dk)) {
        matches++
        break
      }
    }
  }

  return matches / queryKeywords.length
}

type BrainEntry = { brainId: number; description: string }

function collectBrainEntries(messages: MessageWithParts[]): BrainEntry[] {
  const seen = new Set<number>()
  const entries: BrainEntry[] = []

  for (const msg of messages) {
    for (const part of msg.parts) {
      const texts = [part.text, part.state?.output].filter(Boolean) as string[]

      for (const text of texts) {
        for (const marker of parseMarkers(text)) {
          if (!seen.has(marker.brainId)) {
            seen.add(marker.brainId)
            entries.push(marker)
          }
        }
      }
    }
  }

  return entries
}

function findLastUserMessageIndex(messages: MessageWithParts[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info.role === "user") return i
  }
  return -1
}

function getUserMessageText(msg: MessageWithParts): string {
  const texts: string[] = []
  for (const part of msg.parts) {
    if (part.type === "text" && part.text) {
      texts.push(part.text)
    }
  }
  return texts.join(" ")
}

export function findRelevantBrainEntries(messages: MessageWithParts[]): PrefetchCandidate[] {
  const userIdx = findLastUserMessageIndex(messages)
  if (userIdx === -1) return []

  const userText = getUserMessageText(messages[userIdx])
  const queryKeywords = extractKeywords(userText)
  if (queryKeywords.length === 0) return []

  const entries = collectBrainEntries(messages)
  if (entries.length === 0) return []

  const candidates: PrefetchCandidate[] = []
  for (const entry of entries) {
    const descKeywords = extractKeywords(entry.description)
    const score = scoreDescription(descKeywords, queryKeywords)
    if (score >= MIN_SCORE) {
      candidates.push({ brainId: entry.brainId, description: entry.description, score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, 5)
}

export function buildPrefetchHint(candidates: PrefetchCandidate[]): string {
  if (candidates.length === 0) return ""

  const lines = [
    "[context-gc] Relevant brain entries for your current question:",
  ]

  for (const c of candidates) {
    lines.push(`  - brain#${c.brainId}: ${c.description}`)
  }

  lines.push("Recall with: nous-memory get <ID>")

  return lines.join("\n")
}

export function injectPrefetchHint(messages: MessageWithParts[]): boolean {
  const candidates = findRelevantBrainEntries(messages)
  if (candidates.length === 0) return false

  const userIdx = findLastUserMessageIndex(messages)
  if (userIdx === -1) return false

  const lastUser = messages[userIdx]

  const alreadyHasPrefetch = lastUser.parts.some((part) => {
    return part.type === "text" && part.text?.includes("Relevant brain entries for your current question")
  })

  if (alreadyHasPrefetch) return false

  const hint = buildPrefetchHint(candidates)
  lastUser.parts.push({ type: "text", text: hint } as GcPart)
  return true
}
