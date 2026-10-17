import type { PrWatchEvent, PrWatchRegistration, PrWatchSnapshot } from "./state"

function checksPassed(snapshot: PrWatchSnapshot): boolean {
  const checks = snapshot.details?.checks ?? []
  const required = checks.filter((check) => check.required)
  const gates = required.length ? required : checks
  return gates.length > 0 && gates.every((check) => check.status === "COMPLETED" && ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(check.conclusion ?? ""))
}

export function prWatchTransitions(previous: PrWatchSnapshot | undefined, current: PrWatchSnapshot, registration: PrWatchRegistration): PrWatchEvent[] {
  const events: PrWatchEvent[] = []
  const details = current.details
  if (details) {
    for (const check of details.checks) {
      if (["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED", "STARTUP_FAILURE"].includes(check.conclusion ?? "")) {
        events.push({ key: `failed:${details.head}:${check.id}:${check.conclusion}`, kind: "check_failed", fact: `Check ${check.name} reported ${check.conclusion} on ${details.head}.` })
      }
    }
    if (checksPassed(current) && (!previous || details.head !== previous.details?.head || !checksPassed(previous))) {
      events.push({ key: `green:${details.head}:${current.transition}`, kind: "checks_passed", fact: `Required checks passed on ${details.head} (all checks are used when GitHub marks none required).` })
    }
    if (details.mergeable === "CONFLICTING" && previous?.details?.mergeable !== "CONFLICTING") {
      events.push({ key: `conflict:${details.head}:${current.transition}`, kind: "conflict", fact: `The PR branch now conflicts with its base at ${details.head}.` })
    }
  }
  for (const remark of current.activity?.remarks ?? []) {
    if (remark.author.toLowerCase() === registration.actor || Date.parse(remark.updatedAt) < registration.startedAt) continue
    events.push({ key: `remark:${remark.id}:${remark.updatedAt}`, kind: "comment", fact: `${remark.author} added or edited a ${remark.kind}: ${remark.url}` })
  }
  return events
}
