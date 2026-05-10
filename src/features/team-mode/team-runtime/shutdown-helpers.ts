import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"

import type { Message, RuntimeState } from "../types"

export const DELETABLE_MEMBER_STATUSES = new Set<RuntimeState["members"][number]["status"]>([
  "completed",
  "shutdown_approved",
  "errored",
])

export function createShutdownMessage(from: string, to: string, kind: Message["kind"], body: string): Message {
  return {
    version: 1,
    messageId: randomUUID(),
    from,
    to,
    kind,
    body,
    timestamp: Date.now(),
  }
}

export function getRuntimeMember(runtimeState: RuntimeState, memberName: string): RuntimeState["members"][number] {
  const member = runtimeState.members.find((candidate) => candidate.name === memberName)
  if (!member) {
    throw new Error(`unknown member '${memberName}'`)
  }

  return member
}

export function getLeadMemberName(runtimeState: RuntimeState): string {
  const leadMember = runtimeState.members.find((member) => member.agentType === "leader")
  if (!leadMember) {
    throw new Error(`team '${runtimeState.teamRunId}' is missing a lead member`)
  }

  return leadMember.name
}

export function createSendContext(
  runtimeState: RuntimeState,
  senderName: string,
): { isLead: boolean; activeMembers: string[] } {
  const sender = getRuntimeMember(runtimeState, senderName)
  return {
    isLead: sender.agentType === "leader",
    activeMembers: runtimeState.members.map((member) => member.name),
  }
}

export function findLatestShutdownRequestIndex(
  runtimeState: RuntimeState,
  memberName: string,
  requesterName?: string,
): number {
  for (let index = runtimeState.shutdownRequests.length - 1; index >= 0; index -= 1) {
    const shutdownRequest = runtimeState.shutdownRequests[index]
    if (shutdownRequest.memberId !== memberName) continue
    if (requesterName !== undefined && shutdownRequest.requesterName !== requesterName) continue
    return index
  }

  return -1
}

export async function removeWorktrees(memberPaths: Array<string | undefined>): Promise<string[]> {
  const removedWorktrees: string[] = []

  for (const memberPath of new Set(memberPaths)) {
    if (!memberPath) continue
    await rm(memberPath, { recursive: true, force: true })
    removedWorktrees.push(memberPath)
  }

  return removedWorktrees
}
