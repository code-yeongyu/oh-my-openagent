import { basename } from "node:path"

import { CHILDREN_PER_PARENT } from "./task-host-e2e-shards-support.mjs"

// Pure verdict rules for the crash lane's parent-visible notice and `host status --all` facts
// (plan todo 14 steps (5)-(7)); proven by task-host-e2e-shards-crash.test.mjs.

const CRASH_TOKEN = "host_shard_crash"
const CRASH_DONE_TOKEN = "host_shard_crash_done"
const ANY_CRASH_LINE = /^host_shard_crash(?:_done)?:/
// The closing line after `host_shard_crash_done:<key> `: no loss leads with the reattached count,
// a loss leads with the lost count; a cancelled tail is optional.
const CLOSING = /^(?:(\d+) (subagents?) reattached, 0 lost|(\d+) (subagents?) lost \(reattach failed\), (\d+) reattached)(?:, (\d+) cancelled)?$/

const noun = (count, word) => word === (count === 1 ? "subagent" : "subagents")

// "<N> subagent(s) reattached, 0 lost" or "<L> subagent(s) lost (reattach failed), <R> reattached",
// covering every one of the crashed parent's children. Returns a problem or undefined.
function closingProblem(counts) {
  const match = CLOSING.exec(counts)
  if (match === null) return `closing line does not use the current wording: ${JSON.stringify(counts)}`
  const [, reattachedOnly, reattachedWord, lost, lostWord, reattachedAfterLoss, cancelled] = match
  const total = reattachedOnly !== undefined
    ? Number(reattachedOnly)
    : Number(lost) + Number(reattachedAfterLoss)
  if (reattachedOnly !== undefined ? !noun(Number(reattachedOnly), reattachedWord) : !noun(Number(lost), lostWord)) {
    return `closing line count and noun disagree: ${JSON.stringify(counts)}`
  }
  if (total + Number(cancelled ?? 0) !== CHILDREN_PER_PARENT) {
    return `closing line accounts for ${total + Number(cancelled ?? 0)} children, not ${CHILDREN_PER_PARENT}`
  }
  return undefined
}

export const statusRow = (facts, socket) =>
  facts.statusAfter?.endpoints?.find((row) => basename(row.socket ?? "") === basename(socket))

// Plan todo 14 steps (6) and (7) for the crashed parent A: exactly one crash line and one closing
// line for A's shard key in A's notice list, the closing line in the current wording, and the
// `host status --all` row for A's endpoint showing a crash and a new instance.
export function crashedParentProblems(facts) {
  const problems = []
  const lines = facts.notices?.crashed
  if (!Array.isArray(lines)) return ["crashed parent's task_output notice list was not read"]
  const crash = lines.filter((line) => line.startsWith(`${CRASH_TOKEN}:${facts.crashedKey} `))
  const done = lines.filter((line) => line.startsWith(`${CRASH_DONE_TOKEN}:${facts.crashedKey} `))
  if (crash.length !== 1) problems.push(`${crash.length} ${CRASH_TOKEN}:${facts.crashedKey} lines, want 1`)
  if (done.length !== 1) problems.push(`${done.length} ${CRASH_DONE_TOKEN}:${facts.crashedKey} lines, want 1`)
  const foreign = lines.filter((line) => ANY_CRASH_LINE.test(line) && !crash.includes(line) && !done.includes(line))
  if (foreign.length > 0) problems.push(`crash lines for another shard: ${JSON.stringify(foreign)}`)
  if (done.length === 1) {
    const problem = closingProblem(done[0].slice(`${CRASH_DONE_TOKEN}:${facts.crashedKey} `.length))
    if (problem !== undefined) problems.push(problem)
  }
  if (facts.statusAfter?.mode !== "all") problems.push(`host status --all unavailable (${facts.statusAfter?.mode})`)
  const row = statusRow(facts, facts.crashedSocket)
  if (row === undefined) problems.push("host status --all has no row for the crashed endpoint")
  else {
    if (!(row.crashes >= 1)) problems.push(`crashed endpoint reports crashes=${row.crashes}, want >= 1`)
    if (typeof row.instanceId !== "string" || row.instanceId === facts.crashedInstanceBefore) {
      problems.push(`crashed endpoint instanceId ${row.instanceId} is not a new instance (was ${facts.crashedInstanceBefore})`)
    }
  }
  return problems
}

// Plan todo 14 steps (5) and (7) for the bystander parent B: no crash line of any shard in B's
// notice list, and B's endpoint still reports zero crashes.
export function bystanderProblems(facts) {
  const problems = []
  const lines = facts.notices?.bystander
  if (!Array.isArray(lines)) problems.push("bystander parent's task_output notice list was not read")
  else {
    const leaked = lines.filter((line) => ANY_CRASH_LINE.test(line))
    if (leaked.length > 0) problems.push(`bystander parent was told of a crash: ${JSON.stringify(leaked)}`)
  }
  if (facts.statusAfter?.mode !== "all") problems.push(`host status --all unavailable (${facts.statusAfter?.mode})`)
  const row = statusRow(facts, facts.bystanderSocket)
  if (row === undefined) problems.push("host status --all has no row for the bystander endpoint")
  else if (row.crashes !== 0) problems.push(`bystander endpoint reports crashes=${row.crashes}, want 0`)
  return problems
}
