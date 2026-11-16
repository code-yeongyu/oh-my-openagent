import { Type } from "typebox"

import { IdempotencyKey } from "./fields"

export const ThreadCreateParams = Type.Object({
  thread: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Id or alias of an EXISTING thread to open, on whichever of the account's devices holds it; leave unset to create a new thread. Never combined with device.",
    }),
  ),
  device: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Account device to create the new thread on (from thread_list with all_scope); leave unset to create it on this device. Only for a new thread.",
    }),
  ),
  alias: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 64,
      description:
        'Account-wide alias for the new thread, usable instead of its id in every thread tool; an alias another thread holds returns alias_taken naming the holder. With no signed-in account it becomes the thread\'s local name instead (unless name is set) and the result carries alias_scope "local".',
    }),
  ),
  name: Type.Optional(
    Type.String({
      description:
        "Display label for the new thread; an existing thread with the same normalized name returns name_conflict, and later renames change only the label while thread_id stays the address.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory the new thread runs in; leaving it unset keeps the thread inside the caller's workspace. A relative path resolves against the caller's folder on this device; on another device pass an absolute path of that device (thread_list with all_scope shows its threads' folders). A folder that does not exist refuses the create with invalid_arguments.",
    }),
  ),
  worktree: Type.Optional(
    Type.Object(
      {
        branch: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 200,
            description: "New branch the worktree checks out; must not exist yet. Default: omo/thread-<time>.",
          }),
        ),
        base: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 200,
            description: "Commit, branch or tag the new branch starts at. Default: the repository's HEAD.",
          }),
        ),
      },
      {
        additionalProperties: false,
        description:
          "Create a new git worktree for the new thread and start the thread in it, on the device the thread is created on: from the repository at cwd (the caller's folder when cwd is unset; required with device), on a new branch, in OmO's worktrees folder on that device. The result's thread.worktree names its path, branch and base commit. A folder that is not a git repository, a branch that exists, a path that exists, no disk space or no permission each refuse the create with a typed code and details.reason; nothing is opened then. Only for a new thread.",
      },
    ),
  ),
  fork_from: Type.Optional(
    Type.String({
      description:
        "Durable id of an existing thread to fork. The engine does not fork on open yet (#13031), so this is refused with unsupported (details.reason fork_unsupported) and nothing is created; create a thread and hand it the context with thread_send instead.",
    }),
  ),
  skills: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
      minItems: 1,
      maxItems: 16,
      description:
        "Names of installed skills the new thread follows from its first turn, as if each were loaded with /skill. A path or text that is not a skill name refuses the create. The new session applies each name its own skill registry holds and logs any it does not; the result's thread.requested_skills echoes the names passed.",
    }),
  ),
  idempotency_key: IdempotencyKey,
})
