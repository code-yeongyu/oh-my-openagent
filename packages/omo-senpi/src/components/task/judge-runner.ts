import { InProcessRunner, findModelReference } from "@oh-my-opencode/senpi-task"
import type { InProcessRunnerLike, InProcessRunnerOptions } from "@oh-my-opencode/senpi-task"

// The memorian judge borrows the task engine's in-process runner. It is constructed HERE, next to
// engine-runners.ts, so the omo-task sidecar reaches runners/in-process through exactly one path
// (the senpi-task barrel). A second value import of InProcessRunner from the build-graph entry gave
// that subtree two roots, and bun's emit order for it became scheduling-dependent on 4-core Linux
// runners: identical inputs, byte-different omo-task.js in roughly one contended build out of six.
export function createInProcessJudgeRunner(options: InProcessRunnerOptions = {}): InProcessRunnerLike {
  return new InProcessRunner(options)
}

export { findModelReference }
export type { InProcessRunnerLike }
