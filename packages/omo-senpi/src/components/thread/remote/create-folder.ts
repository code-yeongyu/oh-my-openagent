import { homedir } from "node:os"
import { isAbsolute, posix, resolve, win32 } from "node:path"
import type { WorktreeRequest } from "../worktree/thread-worktree"
import { folderFailure } from "../worktree/failures"
import type { CreatePlan } from "./plan-create"

const absoluteOnAnyDevice = (path: string): boolean => posix.isAbsolute(path) || win32.isAbsolute(path)

/**
 * The folder a new thread is created in, settled before anything opens: a relative `cwd` (and `~`) resolves against the
 * caller's folder on this device, and is refused on another device, whose folders this device cannot see; a worktree
 * needs a repository folder, so it is refused when none is known. An open of an existing thread is left as it is.
 */
export function placeFolder(plan: CreatePlan, worktree: WorktreeRequest | undefined, callerCwd?: string): CreatePlan {
  if (plan.kind !== "open" || !plan.creates) return plan
  const here = plan.host.device === undefined
  const asked = plan.request.cwd
  let cwd = asked
  if (asked !== undefined && here && !isAbsolute(asked)) {
    const home = asked === "~" || asked.startsWith("~/") ? homedir() + asked.slice(1) : undefined
    if (home === undefined && callerCwd === undefined)
      return {
        kind: "done",
        result: folderFailure("relative_path", `cwd ${asked} is relative and the caller's folder is unknown.`, {
          path: asked,
        }),
      }
    cwd = home ?? resolve(callerCwd ?? "", asked)
  }
  if (asked !== undefined && !here && !absoluteOnAnyDevice(asked))
    return {
      kind: "done",
      result: folderFailure("relative_path", `cwd ${asked} must be an absolute folder of device ${plan.host.device}.`, {
        path: asked,
        device: plan.host.device,
      }),
    }
  if (worktree !== undefined && cwd === undefined)
    return {
      kind: "done",
      result: folderFailure(
        "relative_path",
        here
          ? "A worktree needs the repository folder and the caller's folder is unknown; pass cwd."
          : `A worktree on device ${plan.host.device} needs its repository folder there; pass cwd.`,
        here ? {} : { device: plan.host.device },
      ),
    }
  return {
    ...plan,
    request: {
      ...plan.request,
      ...(cwd === undefined ? {} : { cwd }),
      ...(worktree === undefined ? {} : { worktree }),
    },
  }
}
