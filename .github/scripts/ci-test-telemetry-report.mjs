import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// The profile's own verdict, run as a non-required step: every invocation that left a boundary
// snapshot must have a complete profile (no fallback, no capture errors, at least one sample).
export function judgeProfiles(directory) {
  const names = existsSync(directory) ? readdirSync(directory) : []
  const invocations = names.filter((name) => /^[a-z0-9-]+\.json$/.test(name) && !name.endsWith("-profile.json") && !name.endsWith("-files.json"))
    .map((name) => name.slice(0, -".json".length))
  const problems = []
  if (invocations.length === 0) problems.push("no profiled invocation left a boundary snapshot")
  for (const invocation of invocations) {
    const path = join(directory, `${invocation}-profile.json`)
    if (!existsSync(path)) {
      problems.push(`${invocation}: profile missing`)
      continue
    }
    try {
      const profile = JSON.parse(readFileSync(path, "utf8"))
      if (profile.fallback) problems.push(`${invocation}: ran unprofiled (setup fallback)`)
      if (!(profile.sampleCount > 0)) problems.push(`${invocation}: no samples`)
      if (!Array.isArray(profile.errors) || profile.errors.length > 0) {
        problems.push(`${invocation}: capture errors ${JSON.stringify(profile.errors ?? null)}`)
      }
    } catch (error) {
      problems.push(`${invocation}: unreadable profile (${error.name})`)
    }
  }
  return { invocations, problems }
}

if (import.meta.main) {
  const { invocations, problems } = judgeProfiles(process.argv[2] ?? ".")
  const verdict = problems.length === 0
    ? `Profile complete for ${invocations.length} invocation(s): ${invocations.join(", ")}.`
    : `Profile incomplete:\n${problems.map((problem) => `- ${problem}`).join("\n")}`
  console.log(verdict)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Shard profile verdict\n${verdict}\n`)
  process.exitCode = problems.length === 0 ? 0 : 1
}
