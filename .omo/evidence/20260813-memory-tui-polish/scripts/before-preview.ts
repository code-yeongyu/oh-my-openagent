// BEFORE snapshot: the dev renderers verbatim (git show origin/dev:...completion.ts),
// reproduced here only to capture evidence. Deleted after capture.
import { normalizeRendererText } from "@oh-my-opencode/senpi-task/renderer-text"
import { linesComponent } from "@oh-my-opencode/senpi-task/task-renderers"

const launched = { runId: "reflection-run-2", trigger: "step-count", backlogSteps: 25 }
const merged = { outcome: "merged", runId: "reflection-run-2", category: "quick", detail: undefined as string | undefined }
const failed = { outcome: "failed", runId: "reflection-run-2", category: "quick", detail: "worktree merge refused because memory had uncommitted changes on the target branch" }

function launchedComponent(l: typeof launched) {
  return linesComponent([`memory reflection started run:${normalizeRendererText(l.runId)} trigger:${normalizeRendererText(l.trigger)} (+${l.backlogSteps} steps)`])
}
function completionComponent(r: typeof merged) {
  const detail = r.detail ? [`detail:${normalizeRendererText(r.detail)}`] : []
  return linesComponent([
    `memory reflection ${normalizeRendererText(r.outcome)}`,
    `run:${normalizeRendererText(r.runId)} category:${normalizeRendererText(r.category)}`,
    ...detail,
  ])
}

const out: string[] = []
for (const width of [60, 100]) {
  out.push(`+${"-".repeat(width)}+`)
  out.push(`|${` TERMINAL WIDTH ${width} `.padEnd(width, " ")}|`)
  out.push(`+${"-".repeat(width)}+`)
  out.push("", "  reflection-launched")
  for (const line of launchedComponent(launched).render(width)) out.push(`  ${line}`)
  out.push("", "  reflection-completion (merged)")
  for (const line of completionComponent(merged).render(width)) out.push(`  ${line}`)
  out.push("", "  reflection-completion (failed)")
  for (const line of completionComponent(failed).render(width)) out.push(`  ${line}`)
  out.push("", "  reflection-summary")
  out.push("  (no renderer registered on dev: entry never rendered in transcript)")
  out.push("", "  senpi-memory.health")
  out.push("  (no renderer registered on dev: entry never rendered in transcript)")
  out.push("")
}
process.stdout.write(`${out.join("\r\n")}\r\n`)
