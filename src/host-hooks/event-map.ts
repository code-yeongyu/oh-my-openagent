import type { HostKind } from "../host-contract"

export type HostHookTier = "session" | "tool-guard" | "transform" | "continuation" | "skill"

export type TargetHookEventName =
  | "session_start"
  | "session_shutdown"
  | "session_compact"
  | "session.compacting"
  | "tool_call"
  | "tool_result"
  | "input"
  | "context"
  | "before_agent_start"
  | "resources_discover"
  | "auto_compaction_start"
  | "auto_compaction_end"

export type TargetHookEventMapping = {
  tier: HostHookTier
  targetEvent: TargetHookEventName
  opencodeSurface: string
  hosts: readonly Exclude<HostKind, "opencode">[]
}

export const TARGET_HOOK_EVENT_MAP: readonly TargetHookEventMapping[] = [
  { tier: "session", targetEvent: "session_start", opencodeSurface: "event:session.created", hosts: ["oh-my-pi", "pi"] },
  { tier: "session", targetEvent: "session_shutdown", opencodeSurface: "event:session.deleted", hosts: ["oh-my-pi", "pi"] },
  { tier: "tool-guard", targetEvent: "tool_call", opencodeSurface: "tool.execute.before", hosts: ["oh-my-pi", "pi"] },
  { tier: "tool-guard", targetEvent: "tool_result", opencodeSurface: "tool.execute.after", hosts: ["oh-my-pi", "pi"] },
  { tier: "transform", targetEvent: "input", opencodeSurface: "chat.message", hosts: ["oh-my-pi", "pi"] },
  { tier: "transform", targetEvent: "context", opencodeSurface: "experimental.chat.messages.transform", hosts: ["oh-my-pi", "pi"] },
  { tier: "transform", targetEvent: "before_agent_start", opencodeSurface: "experimental.chat.system.transform", hosts: ["oh-my-pi", "pi"] },
  { tier: "continuation", targetEvent: "session_compact", opencodeSurface: "experimental.compaction.autocontinue", hosts: ["oh-my-pi", "pi"] },
  { tier: "continuation", targetEvent: "session.compacting", opencodeSurface: "experimental.session.compacting", hosts: ["oh-my-pi"] },
  { tier: "skill", targetEvent: "resources_discover", opencodeSurface: "skill hooks", hosts: ["oh-my-pi", "pi"] },
] as const

export function targetHookMappings(host: Exclude<HostKind, "opencode">): readonly TargetHookEventMapping[] {
  return TARGET_HOOK_EVENT_MAP.filter((mapping) => mapping.hosts.includes(host))
}
