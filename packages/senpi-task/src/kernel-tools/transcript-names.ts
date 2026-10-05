import { readFileSync } from "node:fs"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function envelopeName(part: unknown): string | undefined {
  if (!isRecord(part) || part["type"] !== "text" || typeof part["text"] !== "string") return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(part["text"])
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || typeof parsed["kernel_tool"] !== "string") return undefined
  return parsed["kernel_tool"]
}

/**
 * Names of the parent kernel tools this child ALREADY used, read from its own recorded transcript.
 *
 * Nothing about the grant is persisted, so this is the only honest source for a revived child that
 * lost its binding: a recorded tool result must carry both the kernel-tool envelope and the matching
 * recorded tool name. That pairing is what keeps a restored error stub from ever shadowing a live
 * builtin the child still has.
 */
export function recordedKernelToolNames(sessionPath: string): readonly string[] {
  let content: string
  try {
    content = readFileSync(sessionPath, "utf8")
  } catch {
    return []
  }
  const names = new Set<string>()
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let entry: unknown
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isRecord(entry) || entry["type"] !== "message") continue
    const message = entry["message"]
    if (!isRecord(message) || message["role"] !== "toolResult" || !Array.isArray(message["content"])) continue
    const toolName = message["toolName"]
    for (const part of message["content"]) {
      const name = envelopeName(part)
      if (name !== undefined && (typeof toolName !== "string" || toolName === name)) names.add(name)
    }
  }
  return [...names]
}
