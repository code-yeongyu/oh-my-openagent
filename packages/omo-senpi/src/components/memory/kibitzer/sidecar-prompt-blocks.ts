// The blocks every Kibitzer envelope shares: the read-only contract (its rules and the exact five
// tools), the task line, and the field primitives that make "redact, then cap, then escape" the
// only way a transcript-derived string reaches the child.

import { redactUrl } from "@oh-my-opencode/memory-core"

/**
 * The complete model-visible tool registry of the resident sidecar, in registry order. There are no
 * aliases: `memory` is one read-only closure with `search` and `read` operations, never
 * `memory_search` / `memory_read`, and no write-capable tool exists.
 */
export const KIBITZER_SIDECAR_TOOL_NAMES = ["read", "grep", "session_entries", "memory", "nudge"] as const

export type KibitzerSidecarToolName = (typeof KIBITZER_SIDECAR_TOOL_NAMES)[number]

export interface KibitzerFieldCaps {
  /** User prompt text (`memory.recall.event_caps.prompt`). */
  readonly prompt: number
  /** Assistant text (`memory.recall.event_caps.assistant`). */
  readonly assistant: number
  /** Serialized tool arguments (`memory.recall.event_caps.tool_args`). */
  readonly toolArgs: number
  /** Tool result head (`memory.recall.event_caps.result_head`). */
  readonly resultHead: number
  /** Folded event digest; the digest keeps its cursor range even when every body is folded away. */
  readonly digest: number
  /** One-line task summary carried by a reseed. */
  readonly summary: number
  /** Candidate description and excerpt. */
  readonly candidate: number
}

/** Defaults mirror the `memory.recall.event_caps` schema defaults; callers pass resolved config. */
export const KIBITZER_FIELD_CAPS: KibitzerFieldCaps = {
  prompt: 4000,
  assistant: 1500,
  toolArgs: 400,
  resultHead: 600,
  digest: 1024,
  summary: 200,
  candidate: 200,
}

interface ToolContract {
  readonly name: KibitzerSidecarToolName
  readonly args: string
  readonly operations?: string
  readonly summary: string
}

const TOOL_CONTRACTS: readonly ToolContract[] = [
  { name: "read", args: "path, offset?, limit?", summary: "Read one workspace file; the result is capped." },
  { name: "grep", args: "pattern, path?, glob?", summary: "Search the workspace; the match list is capped." },
  { name: "session_entries", args: "since", summary: "Read the parent session entries after a cursor." },
  { name: "memory", args: "operation, query|path", operations: "search,read", summary: "Read memory: search and read only, there is no write operation." },
  { name: "nudge", args: "path, hint", summary: "Your only output: one candidate path and one factual hint of at most 200 characters." },
]

const RULES: readonly { readonly id: string; readonly text: string }[] = [
  { id: "no-memory-write", text: "You never write, edit, move or delete memory, files or state; the parent process owns every write." },
  { id: "nudge-only", text: "Only the nudge tool reaches the primary agent; anything you write outside a tool call is discarded." },
  { id: "silence-default", text: "Stay silent unless a stored memory would change what the primary agent does next." },
]

export function renderContract(): string {
  return [
    "<contract>",
    ...RULES.map((rule) => `<rule id="${rule.id}">${escapeText(rule.text)}</rule>`),
    ...TOOL_CONTRACTS.map((tool) => [
      openTag("tool", [
        ["name", tool.name],
        ["args", tool.args],
        ...(tool.operations === undefined ? [] : [["operations", tool.operations] as const]),
      ]),
      escapeText(tool.summary),
      "</tool>",
    ].join("")),
    "</contract>",
  ].join("\n")
}

export function renderTask(summary: string, caps: KibitzerFieldCaps): string {
  return `<task>\n<summary>${escapeText(singleLine(field(summary, caps.summary)))}</summary>\n</task>`
}

export function resolveCaps(overrides: Partial<KibitzerFieldCaps> | undefined): KibitzerFieldCaps {
  return overrides === undefined ? KIBITZER_FIELD_CAPS : { ...KIBITZER_FIELD_CAPS, ...overrides }
}

export function openTag(name: string, attributes: readonly (readonly [string, string | number])[]): string {
  const rendered = attributes.map(([key, value]) => ` ${key}="${escapeAttribute(String(value))}"`).join("")
  return `<${name}${rendered}>`
}

/**
 * One embedded field: redacted first (a secret must never survive as a truncated fragment), then
 * capped, then - by the caller - escaped, so the cap is measured on the value the child reads.
 */
export function field(raw: string, cap: number): string {
  const redacted = stripControl(redactUrl(raw))
  if (redacted.length <= cap) return redacted
  return cap <= 1 ? redacted.slice(0, Math.max(cap, 0)) : `${redacted.slice(0, cap - 1)}…`
}

export function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim()
}

function stripControl(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
}

export function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;").replace(/"/g, "&quot;")
}

// Attribute values are redacted too: a path or a parent tool name is transcript-derived, so the
// same secret rule applies, and a raw newline or quote inside an attribute would end the envelope.
function escapeAttribute(value: string): string {
  return escapeText(stripControl(redactUrl(value))).replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;")
}
