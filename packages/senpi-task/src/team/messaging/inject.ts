import { ackMessages, pollAndBuildInjection } from "@oh-my-opencode/team-core/team-mailbox"
import type { InjectionResult } from "@oh-my-opencode/team-core/team-mailbox"
import { transitionRuntimeState } from "@oh-my-opencode/team-core/team-state-store"

import type { TeamCoreConfig } from "../runtime-config"

export type BuildMemberUnreadInjectionInput = {
  readonly sessionId: string
  readonly memberName: string
  readonly teamRunId: string
  readonly config: TeamCoreConfig
  readonly turnMarker: string
}

/**
 * On-revive/on-prompt fallback: builds the batched `<peer_message>` envelope for a member's still-unread
 * inbox via team-core `pollAndBuildInjection` (the ONE turn-deduped claim), for the composition layer
 * to prepend to the member's next turn. Ack the returned ids with `ackMemberInjection` AFTER the turn
 * consumes them. Uses the real team-core envelope, keeping the direct-steer envelope honest via a test.
 */
export function buildMemberUnreadInjection(input: BuildMemberUnreadInjectionInput): Promise<InjectionResult> {
  return pollAndBuildInjection(input.sessionId, input.memberName, input.teamRunId, input.config, input.turnMarker)
}

export type AckMemberInjectionInput = {
  readonly memberName: string
  readonly teamRunId: string
  readonly messageIds: readonly string[]
  readonly config: TeamCoreConfig
}

/**
 * Acks the injected message ids after a member's turn consumed them, moving each inbox file into
 * `processed/`. A no-op when `messageIds` is empty.
 */
export function ackMemberInjection(input: AckMemberInjectionInput): Promise<void> {
  if (input.messageIds.length === 0) return Promise.resolve()
  return ackMessages(input.teamRunId, input.memberName, [...input.messageIds], input.config)
}

export type ReleaseMemberInjectionInput = {
  readonly memberName: string
  readonly teamRunId: string
  readonly messageIds: readonly string[]
  readonly config: TeamCoreConfig
}

/**
 * Rolls back an injection claim whose delivery turn never landed: clears the member's
 * `pendingInjectedMessageIds` for the given ids so the next revive/poll re-injects them. The inbox
 * files were never moved by `buildMemberUnreadInjection` (only marked pending in runtime state), so
 * this completes the reserve/commit/release triad for the injection track. A no-op when empty.
 */
export async function releaseMemberInjection(input: ReleaseMemberInjectionInput): Promise<void> {
  if (input.messageIds.length === 0) return
  const drop = new Set(input.messageIds)
  await transitionRuntimeState(
    input.teamRunId,
    (state) => ({
      ...state,
      members: state.members.map((member) =>
        member.name === input.memberName
          ? { ...member, pendingInjectedMessageIds: member.pendingInjectedMessageIds.filter((id) => !drop.has(id)) }
          : member,
      ),
    }),
    input.config,
  )
}
