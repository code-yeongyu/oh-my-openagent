/** GitHub refuses a release body longer than this (HTTP 422 "body is too long (maximum is 125000 characters)"). */
export const RELEASE_BODY_LIMIT = 125_000

const REPO_URL = "https://github.com/code-yeongyu/oh-my-openagent"

function omittedLine(omitted: number, previousTag: string): string {
  const changes = `${omitted} more change${omitted === 1 ? "" : "s"}`
  return `- ...and ${changes}: ${REPO_URL}/compare/${previousTag}...dev (full notes: ${REPO_URL}/blob/dev/CHANGELOG.md)`
}

/** Keeps the newest whole lines that fit under the limit, then one line that counts and links the rest. */
export function fitReleaseBody(lines: readonly string[], previousTag: string, limit = RELEASE_BODY_LIMIT): string {
  const full = lines.join("\n")
  if (full.length <= limit) return full

  const kept: string[] = []
  let length = 0
  for (const [index, line] of lines.entries()) {
    const next = length + (kept.length > 0 ? 1 : 0) + line.length
    const note = omittedLine(lines.length - index - 1, previousTag)
    if (next + 1 + note.length > limit) break
    kept.push(line)
    length = next
  }
  return [...kept, omittedLine(lines.length - kept.length, previousTag)].join("\n")
}
