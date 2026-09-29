import { OK, type RouterGate } from "./types"

// In a chat where this rule is in force, a top-level human message is a request: it opens a work
// item (chat thread + session + binding). Thread replies and DMs route to their existing unit.
export const gate: RouterGate = {
  id: "one_request_one_thread",
  phase: "router",
  run(route) {
    const { event } = route
    const isRequest = event.kind === "channel" && event.key.thread_id === null && !event.author.is_bot
    if (!isRequest || route.open_work_item) return OK
    return { repair: { ...route, open_work_item: true }, note: "a top-level request opens its own work item thread" }
  },
}
