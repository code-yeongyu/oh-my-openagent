import type { EvalHandleHost } from "@code-yeongyu/senpi"
import type { WorkpoolCaller } from "../workpool/types"
import type { WorkpoolEngine } from "../workpool/engine"
import { defaultTranscriptReader } from "../tools/output/transcript"
import type { TranscriptReader } from "../tools/output/types"
import { outputOf, resultOf } from "./control"
import { cancelRef, sendRef, type TaskControl } from "./steer-refs"
import { EvalHandleHostError } from "./errors"
import { watchRefs, type TaskWaiter } from "./watch"

export type EvalHandleHostDeps = {
  readonly tasks: TaskControl & TaskWaiter
  readonly workpools: Pick<WorkpoolEngine, "inspect" | "cancel" | "subscribe">
  readonly poolCaller: (ownerSessionId: string) => WorkpoolCaller
  readonly stateDir: string
  readonly transcriptReader?: TranscriptReader
}

export function createEvalHandleHost(deps: EvalHandleHostDeps): EvalHandleHost {
  const pools = { workpools: deps.workpools, poolCaller: deps.poolCaller }
  const control = { tasks: deps.tasks, pools, stateDir: deps.stateDir, transcriptReader: deps.transcriptReader ?? defaultTranscriptReader }
  const notCompletion = (kind: string): void => {
    if (kind === "completion") throw new EvalHandleHostError("eval_handle_operation_unsupported", "completion handles are owned by the eval runtime")
  }
  return {
    version: 1,
    watch: async (refs, ctx) => {
      for (const ref of refs) notCompletion(ref.kind)
      return watchRefs({ tasks: deps.tasks, pools }, refs, ctx)
    },
    result: async (ref, ctx) => { notCompletion(ref.kind); return resultOf(control, ref, ctx) },
    send: async (ref, message, ctx) => { notCompletion(ref.kind); return sendRef(control, ref, message, ctx) },
    cancel: async (ref, ctx) => { notCompletion(ref.kind); return cancelRef(control, ref, ctx) },
    output: async (ref, request, ctx) => { notCompletion(ref.kind); return outputOf(control, ref, request, ctx) },
  }
}
