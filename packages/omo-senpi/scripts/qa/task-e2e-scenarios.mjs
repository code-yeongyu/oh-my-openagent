export const CHILD_FIRST = "omo e2e child first unit complete"
export const CHILD_SECOND = "omo e2e child second unit complete"
export const SYNC_FINAL = "omo e2e sync child final text"
export const BATCH_FINAL = "omo e2e batch child final text"

export const MAIN_SCRIPT = {
  childSteps: [{ type: "text", text: CHILD_FIRST }, { type: "text", text: CHILD_SECOND }],
  parentSteps: [
    { type: "tool_call", name: "task", arguments: { category: "mockcat", prompt: "do the first unit", run_in_background: true, name: "e2echild" } },
    { type: "text", text: "parent turn one done, going idle" },
    { type: "tool_call", name: "task_send", arguments: { to: "e2echild", deliver_as: "interrupt" } },
    { type: "tool_call", name: "task_send", arguments: { to: "e2echild", message: "do the second unit" } },
    { type: "text", text: "parent turn two done, going idle" },
    { type: "tool_call", name: "task_output", arguments: { name: "e2echild", mode: "full", block: true } },
    { type: "text", text: "parent read the transcript, all done" },
  ],
}

export const SYNC_SCRIPT = {
  childSteps: [{ type: "text", text: SYNC_FINAL }],
  parentSteps: [
    { type: "tool_call", name: "task", arguments: { category: "mockcat", prompt: "do sync work", run_in_background: false, name: "syncchild" } },
    { type: "text", text: "sync task returned inline, done" },
  ],
}

export const BATCH_SCRIPT = {
  childSteps: [{ type: "text", text: `${BATCH_FINAL} one` }, { type: "text", text: `${BATCH_FINAL} two` }],
  parentSteps: [
    {
      type: "tool_call",
      name: "task",
      arguments: {
        category: "mockcat",
        tasks: [
          { prompt: "complete batch unit one", name: "batch-one" },
          { prompt: "complete batch unit two", name: "batch-two" },
        ],
      },
    },
    { type: "text", text: "batch fanout returned inline" },
  ],
}

export const NEGATIVE_SCRIPT = {
  childSteps: [{ type: "text", text: "unused" }],
  parentSteps: [
    { type: "tool_call", name: "task", arguments: { category: "nonexistent-xyz", prompt: "route nowhere", run_in_background: true, name: "badchild" } },
    { type: "text", text: "saw the category error" },
  ],
}
