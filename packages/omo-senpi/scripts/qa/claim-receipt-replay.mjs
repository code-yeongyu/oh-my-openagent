#!/usr/bin/env bun
// Offline replay of the claim-receipt component over saved senpi session JSONL files. It runs the same
// classify/evidence/match functions the live component calls at agent_before_settle, once per final
// assistant answer on each session's active branch, and simulates the once-per-human-input nudge latch.
//
//   bun packages/omo-senpi/scripts/qa/claim-receipt-replay.mjs [--out flagged.jsonl] <session.jsonl>...
import { readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"

import { classifyClaims } from "../../src/components/claim-receipt/classify.ts"
import { buildTimeline, contentText } from "../../src/components/claim-receipt/evidence.ts"
import { isFlagged, matchClaims } from "../../src/components/claim-receipt/match.ts"

const args = process.argv.slice(2)
const outIndex = args.indexOf("--out")
const outPath = outIndex === -1 ? undefined : args[outIndex + 1]
const files = args.filter((_, index) => index !== outIndex && index !== outIndex + 1)

function activeBranch(entries) {
  const byId = new Map(entries.filter((entry) => typeof entry.id === "string").map((entry) => [entry.id, entry]))
  const branch = []
  let cursor = entries.at(-1)
  while (cursor !== undefined) {
    branch.push(cursor)
    cursor = typeof cursor.parentId === "string" ? byId.get(cursor.parentId) : undefined
  }
  return branch.reverse()
}

const isAnswer = (entry) =>
  entry?.type === "message" &&
  entry.message?.role === "assistant" &&
  entry.message.stopReason === "stop" &&
  !(Array.isArray(entry.message.content) && entry.message.content.some((part) => part?.type === "toolCall"))

const totals = { files: 0, unreadable: 0, answers: 0, answersWithClaims: 0, claims: 0, flaggedAnswers: 0, flaggedClaims: 0, nudges: 0 }
const byStatus = {}
const byStrength = {}
const byReason = {}
const byKind = {}
const flaggedRows = []

for (const file of files) {
  let entries
  try {
    entries = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  } catch {
    totals.unreadable += 1
    continue
  }
  totals.files += 1
  const branch = activeBranch(entries)
  const timeline = buildTimeline(branch)
  let epoch = 0
  let nudgedEpoch = -1
  branch.forEach((entry, index) => {
    if (entry?.type === "message" && entry.message?.role === "user") epoch += 1
    if (!isAnswer(entry)) return
    totals.answers += 1
    const claims = classifyClaims(contentText(entry.message.content))
    if (claims.length === 0) return
    totals.answersWithClaims += 1
    totals.claims += claims.length
    const verdicts = matchClaims(timeline, claims, index)
    for (const verdict of verdicts) {
      byStatus[verdict.status] = (byStatus[verdict.status] ?? 0) + 1
      const key = `${verdict.claim.strength}:${verdict.status}`
      byStrength[key] = (byStrength[key] ?? 0) + 1
    }
    const flagged = verdicts.filter(isFlagged)
    if (flagged.length === 0) return
    totals.flaggedAnswers += 1
    totals.flaggedClaims += flagged.length
    if (nudgedEpoch !== epoch) {
      nudgedEpoch = epoch
      totals.nudges += 1
    }
    for (const verdict of flagged) {
      byReason[verdict.reason] = (byReason[verdict.reason] ?? 0) + 1
      byKind[verdict.claim.kind] = (byKind[verdict.claim.kind] ?? 0) + 1
      flaggedRows.push({
        file: basename(file),
        answerEntryId: entry.id,
        kind: verdict.claim.kind,
        strength: verdict.claim.strength,
        rule: verdict.claim.rule,
        reason: verdict.reason,
        sentence: verdict.claim.sentence,
        receipt: verdict.receipt,
        invalidatedBy: verdict.invalidatedBy,
      })
    }
  })
}

if (outPath !== undefined) writeFileSync(outPath, `${flaggedRows.map((row) => JSON.stringify(row)).join("\n")}\n`)
console.log(JSON.stringify({ totals, byStatus, byStrength, byReason, byKind }, null, 2))
