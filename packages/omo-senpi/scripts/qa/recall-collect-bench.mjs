#!/usr/bin/env bun
// Recall collection hot-path benchmark (issue #8335).
//
// Measures the two synchronous CPU stages the kibitzer runs on the main thread at EVERY prompt and
// EVERY tool_call, on a synthetic fixture sized like the reported production case: 800 corpus
// documents (~4MB) and a 200-entry branch window (~1.5MB).
//
//   stage 1  transcript exclusion: one serialized window + one RegExp.test per document (BEFORE)
//            versus the per-entry mention index (AFTER)
//   stage 2  candidate selection: normalizeText over `description\nbody` per document per query
//            (BEFORE) versus the per-revision normalized-haystack memo (AFTER)
//
// Both stages are checked for identical output before any timing is reported: a faster number is
// worthless if the exclusion set or the candidate list moved.
//
// Usage: bun packages/omo-senpi/scripts/qa/recall-collect-bench.mjs [--docs 800] [--triggers 20]

import { matchScore, parseQuery, selectRecallCandidates } from "@oh-my-opencode/memory-core"

import {
  RECALL_PATH_ENTRY_WINDOW,
  createTranscriptMentionIndex,
  excludedPathsByWindowScan,
} from "../../src/components/memory/recall-transcript-mentions.ts"

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = Number.parseInt(process.argv[index + 1] ?? "", 10)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

const DOCUMENT_COUNT = argValue("docs", 800)
const TRIGGERS = argValue("triggers", 20)
const BRANCH_ENTRIES = RECALL_PATH_ENTRY_WINDOW + TRIGGERS + 1
const QUERIES = ["kubernetes rollout drain", '"deployment health endpoint"', "incident postmortem cache"]

/** Deterministic PRNG so two runs on the same machine are comparable. */
function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

// Filler vocabulary shares no token with the queries, so only the planted documents match. A corpus
// where every document matches every query would spend the benchmark inside excerpt building, which
// this change does not touch, and would flatter both sides equally.
const WORDS = [
  "service", "cluster", "pipeline", "review", "summary", "update", "owner", "window", "branch",
  "policy", "record", "session", "vendor", "contract", "channel", "weekly", "budgeting", "roster",
  "handoff", "glossary", "interview", "onboarding", "payroll", "travel", "catalogue", "designer",
  "proposal", "timeline", "workshop", "retrospective",
]

/** One planted match per 20 documents, mirroring how rarely a real corpus AND-matches a query. */
const PLANTED_TEXT = [
  "kubernetes rollout drain checklist",
  "deployment health endpoint verification",
  "incident postmortem cache invalidation",
]

function prose(random, wordCount) {
  const words = []
  for (let index = 0; index < wordCount; index += 1) {
    words.push(WORDS[Math.floor(random() * WORDS.length)])
    if (index % 14 === 13) words.push("\n")
  }
  return words.join(" ")
}

function buildCorpus(random) {
  const documents = []
  for (let index = 0; index < DOCUMENT_COUNT; index += 1) {
    const area = ["reference", "notes", "people", "skills"][index % 4]
    const planted = index % 20 === 0 ? `\n${PLANTED_TEXT[(index / 20) % PLANTED_TEXT.length]}\n` : "\n"
    documents.push({
      path: `${area}/topic-${String(index).padStart(4, "0")}.md`,
      description: `Topic ${index}: ${prose(random, 8)}`,
      // ~5KB of body keeps the corpus near the reported 4MB.
      body: `${prose(random, 360)}${planted}${prose(random, 360)}`,
    })
  }
  return documents
}

function buildBranch(random, documents) {
  const entries = []
  for (let index = 0; index < BRANCH_ENTRIES; index += 1) {
    const mentioned = documents[(index * 7) % documents.length].path
    const text =
      index % 5 === 0
        ? `${prose(random, 950)}\nI read ${mentioned} before answering.\n${prose(random, 100)}`
        : prose(random, 1050)
    entries.push(
      index % 3 === 2
        ? {
            type: "message",
            id: `entry-${String(index).padStart(4, "0")}`,
            message: {
              role: "toolResult",
              toolCallId: `call-${index}`,
              toolName: "read",
              content: [{ type: "text", text }],
            },
          }
        : {
            type: "message",
            id: `entry-${String(index).padStart(4, "0")}`,
            message: { role: index % 2 === 0 ? "user" : "assistant", content: [{ type: "text", text }] },
          },
    )
  }
  return entries
}

/** The scorer selectRecallCandidates ran before the memo: normalize the haystack per query. */
function selectBefore(documents, parsedQueries) {
  const scored = []
  for (const document of documents) {
    const haystack = `${document.description}\n${document.body}`
    let best = null
    for (const parsed of parsedQueries) {
      const score = matchScore(haystack, parsed)
      if (score === null) continue
      if (best === null || score < best) best = score
    }
    if (best === null) continue
    scored.push({ path: document.path, score: best })
  }
  return scored.sort((left, right) => left.score - right.score || left.path.localeCompare(right.path))
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function ms(value) {
  return `${value.toFixed(2)} ms`
}

function bytes(value) {
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

function sortedList(set) {
  return [...set].sort().join("\n")
}

const random = mulberry32(20260916)
const documents = buildCorpus(random)
const entries = buildBranch(random, documents)
const parsedQueries = QUERIES.map(parseQuery)

const corpusBytes = documents.reduce((total, document) => total + document.description.length + document.body.length, 0)
const windowBytes = JSON.stringify(entries.slice(-RECALL_PATH_ENTRY_WINDOW)).length

// --- equivalence gate -------------------------------------------------------------------------
const gateIndex = createTranscriptMentionIndex()
for (let trigger = 0; trigger <= TRIGGERS; trigger += 1) {
  const branch = entries.slice(0, RECALL_PATH_ENTRY_WINDOW + trigger)
  const after = gateIndex.excludedPaths({ sessionId: "bench", entries: branch, documents })
  const before = excludedPathsByWindowScan(branch.slice(-RECALL_PATH_ENTRY_WINDOW), documents)
  if (sortedList(after) !== sortedList(before)) {
    console.error(`exclusion mismatch at trigger ${trigger}: ${before.size} expected, ${after.size} produced`)
    process.exit(1)
  }
}
const candidatesAfter = selectRecallCandidates(documents, QUERIES, { maxItems: 5, surfaced: new Set() })
const candidatesBefore = selectBefore(documents, parsedQueries).slice(0, 5)
const sameCandidates =
  JSON.stringify(candidatesAfter.map((candidate) => [candidate.path, candidate.score])) ===
  JSON.stringify(candidatesBefore.map((candidate) => [candidate.path, candidate.score]))
if (!sameCandidates) {
  console.error("candidate mismatch between the memoized and unmemoized scorers")
  console.error(JSON.stringify({ candidatesBefore, candidatesAfter }, null, 2))
  process.exit(1)
}

// --- stage 1: transcript exclusion ------------------------------------------------------------
const exclusionBefore = []
for (let trigger = 0; trigger < TRIGGERS; trigger += 1) {
  const window = entries.slice(0, RECALL_PATH_ENTRY_WINDOW + trigger).slice(-RECALL_PATH_ENTRY_WINDOW)
  const started = performance.now()
  excludedPathsByWindowScan(window, documents)
  exclusionBefore.push(performance.now() - started)
}

const index = createTranscriptMentionIndex()
const coldStarted = performance.now()
index.excludedPaths({ sessionId: "bench-after", entries: entries.slice(0, RECALL_PATH_ENTRY_WINDOW), documents })
const exclusionAfterCold = performance.now() - coldStarted
const exclusionAfter = []
for (let trigger = 1; trigger <= TRIGGERS; trigger += 1) {
  const branch = entries.slice(0, RECALL_PATH_ENTRY_WINDOW + trigger)
  const started = performance.now()
  index.excludedPaths({ sessionId: "bench-after", entries: branch, documents })
  exclusionAfter.push(performance.now() - started)
}

// --- stage 2: candidate selection -------------------------------------------------------------
const selectionBefore = []
for (let trigger = 0; trigger < TRIGGERS; trigger += 1) {
  const started = performance.now()
  selectBefore(documents, parsedQueries)
  selectionBefore.push(performance.now() - started)
}

// A fresh document object per run is a moved HEAD: the memo starts cold.
const coldDocuments = documents.map((document) => ({ ...document }))
const selectionColdStarted = performance.now()
selectRecallCandidates(coldDocuments, QUERIES, { maxItems: 5, surfaced: new Set() })
const selectionAfterCold = performance.now() - selectionColdStarted
const selectionAfter = []
for (let trigger = 0; trigger < TRIGGERS; trigger += 1) {
  const started = performance.now()
  selectRecallCandidates(documents, QUERIES, { maxItems: 5, surfaced: new Set() })
  selectionAfter.push(performance.now() - started)
}

const exclusionBeforeMedian = median(exclusionBefore)
const exclusionAfterMedian = median(exclusionAfter)
const selectionBeforeMedian = median(selectionBefore)
const selectionAfterMedian = median(selectionAfter)
const totalBefore = exclusionBeforeMedian + selectionBeforeMedian
const totalAfter = exclusionAfterMedian + selectionAfterMedian

console.log("recall collect bench (issue #8335)")
console.log(
  `fixture: ${documents.length} documents (${bytes(corpusBytes)}), window ${RECALL_PATH_ENTRY_WINDOW} entries (${bytes(windowBytes)}), ${TRIGGERS} triggers, ${QUERIES.length} queries`,
)
console.log("outputs identical: yes (exclusion set per trigger, candidate paths and scores)")
console.log("")
console.log("stage                         before (median)   after (median)   speedup")
console.log(
  `transcript exclusion          ${ms(exclusionBeforeMedian).padEnd(17)} ${ms(exclusionAfterMedian).padEnd(16)} ${(exclusionBeforeMedian / exclusionAfterMedian).toFixed(1)}x`,
)
console.log(
  `candidate selection           ${ms(selectionBeforeMedian).padEnd(17)} ${ms(selectionAfterMedian).padEnd(16)} ${(selectionBeforeMedian / selectionAfterMedian).toFixed(1)}x`,
)
console.log(
  `per-trigger total             ${ms(totalBefore).padEnd(17)} ${ms(totalAfter).padEnd(16)} ${(totalBefore / totalAfter).toFixed(1)}x`,
)
console.log("")
console.log(`first collect of a session (cold caches): exclusion ${ms(exclusionAfterCold)}, selection ${ms(selectionAfterCold)}`)
console.log(
  `per-trigger after: min ${ms(Math.min(...exclusionAfter) + Math.min(...selectionAfter))}, max ${ms(Math.max(...exclusionAfter) + Math.max(...selectionAfter))}`,
)
