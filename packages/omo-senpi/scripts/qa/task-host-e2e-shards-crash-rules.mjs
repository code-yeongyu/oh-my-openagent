import { basename } from "node:path"

// Recovered crashes stay silent; host status and child outcomes prove the recovery.
const ANY_CRASH_LINE = /^host_shard_crash(?:_done)?:/

export const statusRow = (facts, socket) =>
  facts.statusAfter?.endpoints?.find((row) => basename(row.socket ?? "") === basename(socket))

// Parent A recovers without a crash notice; its endpoint reports the crash and a new instance.
export function crashedParentProblems(facts) {
  const problems = []
  const lines = facts.notices?.crashed
  if (!Array.isArray(lines)) return ["crashed parent's task_output notice list was not read"]
  const leaked = lines.filter((line) => ANY_CRASH_LINE.test(line))
  if (leaked.length > 0) problems.push(`recovered crash emitted notices: ${JSON.stringify(leaked)}`)
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
