import type { ThreadArchiveInput, ThreadToolResult } from "../contracts"
import { locateControl } from "../control/locate"
import { failure } from "./internals"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "./ports"

/**
 * `thread_archive`: sets the archived flag in the thread's session file (senpi `set_session_archived`) and nothing else:
 * the session keeps running and stays open. The caller's own thread is refused `turn_active` while its turn runs, so
 * nothing is archived mid-turn; the desktop's `thread_organize` archive also unloads the session.
 */
export async function archiveThread(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  value: ThreadArchiveInput,
  callerId: string,
): Promise<ThreadToolResult> {
  const archived = value.archived ?? true
  const located = await locateControl(options, current, value.thread, value.all_scope, callerId)
  if (located.kind === "error") return located.result
  if (located.kind === "not_live")
    return failure(
      "not_resumable",
      `Thread ${located.thread_id} has no engine holding it, so its session file cannot be ${archived ? "archived" : "unarchived"} now.`,
      "Open it with thread_create (tool.thread_create({ thread }) in an eval cell), then retry.",
    )
  const { control } = located
  if (archived && control.device === undefined && control.thread_id === callerId && (await control.running()))
    return failure(
      "turn_active",
      "This is the calling thread and its turn is still running; archiving it mid-turn is refused.",
      "Archive it from another thread, or after this turn ends.",
      { thread: control.thread_id },
    )
  await control.setArchived(archived)
  return { kind: "ok", ...(await control.listed(archived)), archived }
}
