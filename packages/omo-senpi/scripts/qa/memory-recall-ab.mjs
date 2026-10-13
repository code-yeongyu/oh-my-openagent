#!/usr/bin/env bun
// Recall A/B on your own memory, with the method of #9957: each labeled question goes through the real
// recall path (planRecallQueries -> selectRecallCandidates, maxItems 10, automatic strategy) and is
// scored against its gold note: Recall@1/5/10, MRR@10, warm selection time p50/p95.
//
// One arm per process, so a process holds one corpus and one index:
//
//   build    turn a folder of Markdown files into a git memory repo (path = reference/<relative path>,
//            description = first heading or first line; --exclude a,b skips those relative folders). Your real memory repo needs no build step.
//   run      --arm off  : today's plan (memory.recall.query_rarity off: the two longest words)
//            --arm on   : the plan with the memory's word rarity (memory.recall.query_rarity on)
//            --code-root <checkout> measures another checkout's memory-core instead of this one (for
//            example a dev checkout as the baseline); --aggregate-only writes numbers and per-question
//            hashes only (no paths, no question text), safe to share for a private memory.
//   compare  per-question identity of two run files (rank, path hash and score per result) plus the table.
//
// Questions file: JSON array of { "id", "lang", "question", "goldPath" } (goldPath = memory path), or an
// object of named arrays picked with --set; the published public sets are
// fixtures/memory-recall-ab-public-questions.json (head90 = 90 questions EN45/KO45, deep30 = 30 deep answers).
//
//   bun packages/omo-senpi/scripts/qa/memory-recall-ab.mjs build --markdown <dir> --out <repo dir>
//   bun packages/omo-senpi/scripts/qa/memory-recall-ab.mjs run --repo <repo dir> --questions q.json --arm off --runs 3 --out off.json
//   bun packages/omo-senpi/scripts/qa/memory-recall-ab.mjs run --repo <repo dir> --questions q.json --arm on --runs 3 --out on.json
//   bun packages/omo-senpi/scripts/qa/memory-recall-ab.mjs compare off.json on.json

import { createHash } from "node:crypto"
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const argv = process.argv.slice(2)
const mode = argv[0]
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)

async function loadCore() {
  const root = flag("code-root")
  return root === undefined
    ? import("@oh-my-opencode/memory-core")
    : import(resolve(root, "packages/memory-core/src/index.ts"))
}

const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16)

function describe(content, fallback) {
  let fenced = false
  let first
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  let start = 0
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
    if (end > 0) start = end + 1
  }
  for (const raw of lines.slice(start)) {
    const line = raw.trim()
    if (line.startsWith("```")) fenced = !fenced
    if (fenced || line === "" || line === "---" || line.startsWith("```")) continue
    if (/^#{1,6}\s+\S/.test(line)) return clip(line.replace(/^#{1,6}\s+/, ""))
    first ??= line
  }
  return clip(first ?? fallback)
}
const clip = (text) => text.replace(/\s+/g, " ").trim().slice(0, 200).trim() || "untitled"

function* markdownFiles(dir, root = dir, excluded = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === ".git") continue
    const full = join(dir, name)
    if (excluded.includes(relative(root, full))) continue
    const entry = lstatSync(full)
    // Symlinks are skipped, so a mirrored folder is not indexed twice.
    if (entry.isDirectory()) yield* markdownFiles(full, root, excluded)
    else if (entry.isFile() && name.endsWith(".md")) yield relative(root, full)
  }
}

async function build() {
  const { GitMemoryRepo, renderMemoryFile } = await loadCore()
  const source = resolve(flag("markdown"))
  const seedFiles = []
  const excluded = (flag("exclude") ?? "").split(",").filter(Boolean)
  for (const path of markdownFiles(source, source, excluded)) {
    const content = readFileSync(join(source, path), "utf8")
    seedFiles.push({ relativePath: `reference/${path}`, content: renderMemoryFile({ description: describe(content, path) }, content) })
  }
  const repo = new GitMemoryRepo({ dir: resolve(flag("out")), agentId: "memory-recall-ab" })
  const head = await repo.init({ seedFiles })
  console.log(JSON.stringify({ notes: seedFiles.length, head }))
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] ?? 0
}

function metrics(rows) {
  const n = rows.length
  const at = (k) => rows.filter((row) => row.rank !== null && row.rank <= k).length / n
  return {
    n,
    recall1: at(1),
    recall5: at(5),
    recall10: at(10),
    mrr10: rows.reduce((sum, row) => sum + (row.rank === null ? 0 : 1 / row.rank), 0) / n,
    p50Ms: percentile(rows.map((row) => row.ms), 0.5),
    p95Ms: percentile(rows.map((row) => row.ms), 0.95),
  }
}

async function run() {
  const core = await loadCore()
  const { GitMemoryRepo, loadRecallCorpus, planRecallQueries, selectRecallCandidates } = core
  const arm = flag("arm", "off")
  if (arm !== "off" && arm !== "on") throw new Error("--arm must be off or on")
  if (arm === "on" && core.recallTermRarity === undefined) throw new Error("this memory-core has no query rarity; run --arm off against it")
  const loaded = JSON.parse(readFileSync(resolve(flag("questions")), "utf8"))
  // A plain array, or a fixture object holding named sets chosen with --set (fixtures/memory-recall-ab-public-questions.json).
  const questions = Array.isArray(loaded) ? loaded : loaded[flag("set", "head90")]
  const runs = Number(flag("runs", "3"))
  const aggregateOnly = has("aggregate-only")
  const loadStart = performance.now()
  const { documents, revision } = await loadRecallCorpus(new GitMemoryRepo({ dir: resolve(flag("repo")), agentId: "memory-recall-ab" }))
  const loadMs = performance.now() - loadStart
  const options = { maxItems: 10, surfaced: new Set() }
  const plan = (text) => (arm === "on" ? planRecallQueries([text], { rarity: core.recallTermRarity(documents) }) : planRecallQueries([text]))
  const buildStart = performance.now()
  selectRecallCandidates(documents, planRecallQueries(["memory recall index build"]), options)
  const firstSelectMs = performance.now() - buildStart

  const perRun = []
  let signatures
  for (let index = 0; index < runs; index += 1) {
    const rows = []
    const runSignatures = {}
    for (const question of questions) {
      const queries = plan(question.question)
      const start = performance.now()
      const items = selectRecallCandidates(documents, queries, options)
      const ms = performance.now() - start
      const position = items.findIndex((item) => item.path === question.goldPath)
      rows.push({ lang: question.lang, rank: position < 0 ? null : position + 1, ms })
      runSignatures[question.id] = sha(items.map((item) => `${item.path}\u0000${item.score}`).join("\n"))
      if (!aggregateOnly && index === 0) rows.at(-1).top10 = items.map((item) => item.path)
    }
    if (signatures !== undefined && JSON.stringify(signatures) !== JSON.stringify(runSignatures)) throw new Error("rankings differ between runs of one arm")
    signatures = runSignatures
    const byLang = Object.fromEntries([...new Set(rows.map((row) => row.lang))].map((lang) => [lang, metrics(rows.filter((row) => row.lang === lang))]))
    perRun.push({ all: metrics(rows), byLang, ...(aggregateOnly ? {} : { ranks: Object.fromEntries(questions.map((q, i) => [q.id, rows[i].rank])) }) })
  }
  const result = {
    arm,
    codeRoot: flag("code-root") ?? "this checkout",
    corpus: { notes: documents.length, revision: aggregateOnly ? sha(String(revision)) : revision, loadMs, firstSelectMs },
    questions: questions.length,
    runs: perRun,
    signatures,
    peakRssMb: Math.round(process.memoryUsage().rss / 1048576),
  }
  writeFileSync(resolve(flag("out")), JSON.stringify(result, null, 2))
  const first = perRun[0].all
  console.log(JSON.stringify({ arm, notes: documents.length, recall1: first.recall1, recall5: first.recall5, recall10: first.recall10, mrr10: first.mrr10, p50Ms: perRun.map((r) => r.all.p50Ms) }))
}

function compare() {
  const files = argv.slice(1).filter((arg) => !arg.startsWith("--"))
  const results = files.map((file) => ({ file, ...JSON.parse(readFileSync(resolve(file), "utf8")) }))
  const fmt = (value) => value.toFixed(3)
  const range = (values) => {
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    return lo === hi ? lo.toFixed(1) : `${lo.toFixed(1)}-${hi.toFixed(1)}`
  }
  console.log("| run | arm | R@1 | R@5 | R@10 | MRR@10 | p50 ms | p95 ms |")
  console.log("|---|---|---|---|---|---|---|---|")
  for (const result of results) {
    const all = result.runs[0].all
    console.log(`| ${result.file} | ${result.arm} | ${fmt(all.recall1)} | ${fmt(all.recall5)} | ${fmt(all.recall10)} | ${fmt(all.mrr10)} | ${range(result.runs.map((r) => r.all.p50Ms))} | ${range(result.runs.map((r) => r.all.p95Ms))} |`)
  }
  const [base, ...others] = results
  for (const other of others) {
    const ids = Object.keys(base.signatures)
    const same = ids.filter((id) => base.signatures[id] === other.signatures[id]).length
    console.log(`identity ${base.file} vs ${other.file}: ${same}/${ids.length} questions with identical results`)
  }
}

if (mode === "build") await build()
else if (mode === "run") await run()
else if (mode === "compare") compare()
else {
  console.error("usage: memory-recall-ab.mjs build|run|compare (see the header of this file)")
  process.exit(2)
}
