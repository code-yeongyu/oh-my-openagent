import { INITIAL_SKILLS_CONTEXT_KEY } from "./initial-skills"

/**
 * The `open_session.context` label that tells the engine nobody answers this session's prompts (#14649): a tool call the
 * session's permission preset would ask about is refused with a reason the model reads, instead of waiting on a dialog
 * no client shows. thread_create sets it on every session it opens, on this device and on another one.
 */
const REFUSE_APPROVALS_CONTEXT = { approvals: "refuse" } as const

export function openContext(
  initialSkills: readonly string[] | undefined,
  refuseApprovals: boolean | undefined,
): Readonly<Record<string, string>> | undefined {
  const context = {
    ...(initialSkills === undefined || initialSkills.length === 0
      ? {}
      : { [INITIAL_SKILLS_CONTEXT_KEY]: JSON.stringify(initialSkills) }),
    ...(refuseApprovals === true ? REFUSE_APPROVALS_CONTEXT : {}),
  }
  return Object.keys(context).length === 0 ? undefined : context
}
