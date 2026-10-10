import type { HandleCallContext, HandleOutcome, HandleRef, OutputRequest, OutputSnapshot } from "@code-yeongyu/senpi"
import { renderTranscript } from "../tools/output/render"
import type { TranscriptReader } from "../tools/output/types"
import { EvalHandleHostError } from "./errors"
import { isPoolSettled, loadOwnedPool, poolOutcome } from "./pool-refs"
import type { SteerDeps } from "./steer-refs"
import { isSettled, loadFencedTask, taskOutcome } from "./task-refs"

/** Result and output reads: they never call the engine, so a fenced read is all they need. */
export type ControlDeps = SteerDeps & {
  readonly stateDir: string
  readonly transcriptReader: TranscriptReader
}

const DEFAULT_TAIL_LINES = 60

export function resultOf(deps: ControlDeps, ref: HandleRef, ctx: HandleCallContext): HandleOutcome {
  if (ref.kind === "workpool") {
    const pool = loadOwnedPool(deps.pools, ref, ctx)
    if (!isPoolSettled(pool)) throw new EvalHandleHostError("eval_handle_pending", `${ref.id} is still running`)
    return poolOutcome(pool, ref)
  }
  const record = loadFencedTask(deps.tasks, agentRef(ref), ctx)
  if (!isSettled(record)) throw new EvalHandleHostError("eval_handle_pending", `${ref.id} is still ${record.status}`)
  return taskOutcome(record, ref)
}

export function outputOf(deps: ControlDeps, ref: HandleRef, request: OutputRequest, ctx: HandleCallContext): OutputSnapshot {
  if (ref.kind !== "agent") throw new EvalHandleHostError("eval_handle_operation_unsupported", `output is for agent handles, not ${ref.kind}`)
  loadFencedTask(deps.tasks, ref, ctx)
  const read = deps.transcriptReader({ taskId: ref.id, stateDir: deps.stateDir })
  // A resume during the read would hand back the successor's transcript; re-fence after reading.
  loadFencedTask(deps.tasks, ref, ctx)
  const rendered = renderTranscript(read.entries, { mode: "full", tailLines: 0 })
  const lines = rendered.text.length === 0 ? [] : rendered.text.split("\n")
  const total = lines.length
  const [start, end] = window(request, total)
  return { ref, text: lines.slice(start, end).join("\n"), offset: start, total, truncated: rendered.truncated || read.truncated === true || start > 0 || end < total }
}

function window(request: OutputRequest, total: number): readonly [number, number] {
  if (request.format === "tail") {
    const count = request.limit ?? DEFAULT_TAIL_LINES
    return [Math.max(0, total - count), total]
  }
  const start = Math.min(Math.max(0, request.offset ?? 0), total)
  return [start, request.limit === undefined ? total : Math.min(total, start + request.limit)]
}

function agentRef(ref: HandleRef): HandleRef {
  if (ref.kind !== "agent") throw new EvalHandleHostError("eval_handle_operation_unsupported", `${ref.kind} refs are not served by the task host`)
  return ref
}
