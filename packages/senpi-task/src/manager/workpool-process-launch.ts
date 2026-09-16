import { basename } from "node:path"
import { parseExtensionEntries } from "../runners/rpc/parent-extensions"
import { resolveMemberExtensionEntryPath } from "../team/member-extension"
import { WORKPOOL_STATE_DIR_ENV, WORKPOOL_TASK_ID_ENV } from "../team/member-extension/identity"

export function workpoolProcessLaunch(stateDir: string, taskId: string) {
  // Keep explicit provider extensions, but never load the parent scheduler in the worker.
  const extensions = parseExtensionEntries(process.argv).filter(entry => !["omo.js", "omo-task.js", "omo-member.js"].includes(basename(entry)))
  return { extensions: [...extensions, resolveMemberExtensionEntryPath()], memberEnv: {
    [WORKPOOL_STATE_DIR_ENV]: stateDir, [WORKPOOL_TASK_ID_ENV]: taskId,
  } }
}
