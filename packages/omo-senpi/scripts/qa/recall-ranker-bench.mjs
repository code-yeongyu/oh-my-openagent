#!/usr/bin/env bun
// Recall strategy quality benchmark.
//
// Replays a synthetic, fictional memory corpus (English, Korean, Japanese, Chinese and code-switched
// queries, each with the gold note paths that answer it) through the real recall pipeline:
// planRecallQueries() on the query as a single user message, then selectRecallCandidates() once per
// strategy. `substring` is the ranking before automatic selection, `auto` is what users get now (the
// strategy chooseRecallStrategy picks), and `bm25` / `hybrid` are shown for reference. It reports hit
// rate at 1/2/5 (2 is the default memory.recall.max_items), MRR, queries with no candidate at all, and
// the median warm selection time.
//
// Corpora:
//   en-only       the English notes only, English queries: an English-only user.
//   multilingual  every note, every query, sliced by query language.
//   large-*       the same corpora padded with seeded filler notes whose words are drawn from the
//                 corpus's own vocabulary, so query words also occur in unrelated notes.
//
// Usage: bun packages/omo-senpi/scripts/qa/recall-ranker-bench.mjs [--json] [--sizes 100,200,500,1000]

import { readFileSync } from "node:fs"

import {
  CJK_CORPUS_MIN_SHARE,
  LARGE_CORPUS_MIN_DOCUMENTS,
  chooseRecallStrategy,
  planRecallQueries,
  selectRecallCandidates,
} from "@oh-my-opencode/memory-core"

const STRATEGIES = ["substring", "bm25", "hybrid", "auto"]
const DEPTH = 5
const SEED = 20260930

const fixture = JSON.parse(readFileSync(new URL("./fixtures/recall-ranker-corpus.json", import.meta.url), "utf8"))
const sizesArg = process.argv.indexOf("--sizes")
const SIZES = sizesArg >= 0 ? process.argv[sizesArg + 1].split(",").map(Number) : [100, 200, 500, 1000]

const CJK_PATH = /^reference\/(ko|ja|zh)\//
const englishDocuments = fixture.documents.filter((document) => !CJK_PATH.test(document.path))
const englishQueries = fixture.queries.filter((query) => query.lang === "en")

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Filler notes built from the base corpus's own words, so they share vocabulary with the gold notes. */
function padded(documents, total) {
  const words = documents.flatMap((document) => `${document.description} ${document.body}`.split(/\s+/).filter(Boolean))
  const random = mulberry32(SEED + total)
  const pick = (count) => Array.from({ length: count }, () => words[Math.floor(random() * words.length)]).join(" ")
  const filler = Array.from({ length: Math.max(0, total - documents.length) }, (_, index) => ({
    path: `archive/filler-${String(index).padStart(4, "0")}.md`,
    description: pick(3 + Math.floor(random() * 3)),
    body: pick(30 + Math.floor(random() * 31)),
  }))
  return [...documents, ...filler]
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function select(documents, queries, strategy) {
  const options = { maxItems: DEPTH, surfaced: new Set() }
  return selectRecallCandidates(documents, queries, strategy === "auto" ? options : { ...options, strategy })
}

function evaluate(documents, strategy, queries) {
  let hit1 = 0
  let hit2 = 0
  let hit5 = 0
  let reciprocal = 0
  let empty = 0
  const timings = []
  for (const query of queries) {
    const planned = planRecallQueries([query.text])
    select(documents, planned, strategy)
    const started = performance.now()
    const candidates = select(documents, planned, strategy)
    timings.push(performance.now() - started)
    const gold = new Set(query.gold)
    if (candidates.length === 0) empty += 1
    const rank = candidates.findIndex((candidate) => gold.has(candidate.path))
    if (rank === 0) hit1 += 1
    if (rank >= 0 && rank < 2) hit2 += 1
    if (rank >= 0 && rank < 5) hit5 += 1
    if (rank >= 0) reciprocal += 1 / (rank + 1)
  }
  const count = queries.length
  const ratio = (value) => Number((value / count).toFixed(3))
  return { queries: count, "R@1": ratio(hit1), "R@2": ratio(hit2), "R@5": ratio(hit5), MRR: ratio(reciprocal), empty, medianMs: Number(median(timings).toFixed(3)) }
}

function autoChoices(documents, queries) {
  const counts = {}
  for (const query of queries) {
    const strategy = chooseRecallStrategy(documents, planRecallQueries([query.text]))
    counts[strategy] = (counts[strategy] ?? 0) + 1
  }
  return counts
}

function identicalToSubstring(documents, queries) {
  return queries.filter((query) => {
    const planned = planRecallQueries([query.text])
    return JSON.stringify(select(documents, planned, "auto")) === JSON.stringify(select(documents, planned, "substring"))
  }).length
}

function run(corpus, documents, slices) {
  return slices.flatMap(([slice, queries]) => STRATEGIES.map((strategy) => ({
    corpus,
    notes: documents.length,
    slice,
    strategy,
    ...(strategy === "auto" ? { autoPicked: autoChoices(documents, queries) } : {}),
    ...evaluate(documents, strategy, queries),
  })))
}

const LANGS = ["en", "ko", "ja", "zh", "mixed"]
const bySlice = (queries) => [["all", queries], ...LANGS.map((lang) => [lang, queries.filter((query) => query.lang === lang)])]
  .filter(([, sliceQueries]) => sliceQueries.length > 0)

const results = [
  ...run("en-only", englishDocuments, [["en", englishQueries]]),
  ...run("multilingual", fixture.documents, bySlice(fixture.queries)),
  ...SIZES.flatMap((size) => [
    ...run(`large-en-only`, padded(englishDocuments, size), [["en", englishQueries]]),
    ...run(`large-multilingual`, padded(fixture.documents, size), bySlice(fixture.queries)),
  ]),
]
const identity = { queries: englishQueries.length, identical: identicalToSubstring(englishDocuments, englishQueries) }
const thresholds = { CJK_CORPUS_MIN_SHARE, LARGE_CORPUS_MIN_DOCUMENTS }

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ thresholds, identity, results }, null, 2))
} else {
  console.log(`thresholds: CJK corpus share >= ${CJK_CORPUS_MIN_SHARE}, large corpus >= ${LARGE_CORPUS_MIN_DOCUMENTS} notes`)
  console.log(`en-only: auto returns exactly the substring candidates for ${identity.identical}/${identity.queries} English queries`)
  console.log("| corpus | notes | slice | strategy | auto picked | queries | R@1 | R@2 | R@5 | MRR | no candidate | median ms |")
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|")
  for (const row of results) {
    const picked = row.autoPicked === undefined ? "" : Object.entries(row.autoPicked).map(([name, count]) => `${name} ${count}`).join(", ")
    console.log(`| ${row.corpus} | ${row.notes} | ${row.slice} | ${row.strategy} | ${picked} | ${row.queries} | ${row["R@1"]} | ${row["R@2"]} | ${row["R@5"]} | ${row.MRR} | ${row.empty} | ${row.medianMs} |`)
  }
}
