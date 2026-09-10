// The side panel reads delegated-child records through this runtime rather than importing
// senpi-task into the entry bundle, which would drag the whole task module graph with it.
export { createTaskRecordStore, resolveStateDir } from "@oh-my-opencode/senpi-task"
export { createInProcessJudgeRunner, createTaskComponent, findModelReference } from "../components/task"
export type { InProcessRunnerLike } from "../components/task"
