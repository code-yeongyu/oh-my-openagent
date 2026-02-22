import pc from "picocolors"

const SINGLE_VALUE_FIELDS = ["command", "filePath"] as const

const MULTI_VALUE_FIELDS = [
  "description",
  "pattern",
  "query",
  "url",
  "category",
  "subagent_type",
  "lang",
  "run_in_background",
] as const

export function formatToolInputPreview(input: Record<string, unknown>): string {
  for (const key of SINGLE_VALUE_FIELDS) {
    if (!input[key]) continue
    const maxLen = key === "command" ? 80 : 120
    return ` ${pc.dim(String(input[key]).slice(0, maxLen))}`
  }

  const parts: string[] = []
  let totalLen = 0

  for (const key of MULTI_VALUE_FIELDS) {
    const val = input[key]
    if (val === undefined || val === null) continue
    const str = String(val)
    const truncated = str.length > 50 ? str.slice(0, 47) + "..." : str
    const entry = `${key}=${truncated}`
    if (totalLen + entry.length > 120) break
    parts.push(entry)
    totalLen += entry.length + 1
  }

  return parts.length > 0 ? ` ${pc.dim(parts.join(" "))}` : ""
}
