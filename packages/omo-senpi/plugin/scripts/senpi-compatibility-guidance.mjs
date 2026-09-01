/**
 * Senpi harness tool-compatibility banner injection.
 *
 * Shared-pool skills ported from OpenCode may contain OpenCode-only orchestration examples
 * (call_omo_agent, task, background_output, team_*). When detected, a translation banner is
 * inserted after frontmatter explaining how to map those calls to Senpi native tools.
 * If a banner already precedes the first example, it is left in place.
 */

const opencodeOnlyOrchestrationPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/

export const senpiHarnessToolCompatibility = `## Senpi Harness Tool Compatibility

This skill may include examples copied from the OpenCode harness. In Senpi, do not call OpenCode-only tools such as \`call_omo_agent(...)\`, \`task(...)\`, \`background_output(...)\`, or \`team_*(...)\` literally. Translate those examples to Senpi native tools:

| OpenCode example | Senpi tool to use |
| --- | --- |
| \`call_omo_agent(subagent_type="explore", ...)\` | \`task\` tool with \`subagent_type: "explore"\` |
| \`call_omo_agent(subagent_type="librarian", ...)\` | \`task\` tool with \`subagent_type: "librarian"\` |
| worker/implementation \`task(...)\` | \`task\` tool with \`category\` from the delegation router (\`quick\`, \`unspecified-low\`, \`unspecified-high\`, \`deep\`, \`ultrabrain\`, \`visual-engineering\`, \`writing\`); honor the plan's \`Recommended task executor category:\` line |
| final-review / gate-reviewer \`task(...)\` | fresh \`task\` with \`category: "unspecified-high"\` (or \`"deep"\`) and an adversarial-verifier prompt; \`momus\`/\`metis\` are plan-gated curated reviewers, spawnable only while the plan gate is open |
| \`background_output(task_id="...")\` | \`task_output\` tool with the task id |
| \`team_*(...)\` | Lead team tools (\`team_create\`, \`task_create\`, ...); send with \`task_send\` |
| a watcher on a lane's completion state | \`monitor\` to arm it, \`kill_bash\` to tear it down |

If a code block below conflicts with this section, this section wins.

`

const senpiCompatibilityEndMarkers = [
  "If a code block below conflicts with this section, this section wins.\n\n",
]

function findSenpiCompatibilitySectionEnd(content, searchStart) {
  const structuralEndPattern = /\n(?:---|export\s+const\s+|#{1,6}\s)/g
  structuralEndPattern.lastIndex = searchStart
  const structuralEnd = structuralEndPattern.exec(content)
  if (structuralEnd) return structuralEnd.index + 1

  const knownEndMarker = senpiCompatibilityEndMarkers.find((marker) => content.indexOf(marker, searchStart) !== -1)
  if (knownEndMarker === undefined) return content.length

  return content.indexOf(knownEndMarker, searchStart) + knownEndMarker.length
}

function removeSenpiCompatibilityGuidance(content) {
  const heading = "## Senpi Harness Tool Compatibility"
  let withoutGuidance = content

  while (true) {
    const start = withoutGuidance.indexOf(heading)
    if (start === -1) return withoutGuidance

    const end = findSenpiCompatibilitySectionEnd(withoutGuidance, start + heading.length)
    withoutGuidance = `${withoutGuidance.slice(0, start)}${withoutGuidance.slice(end)}`
  }
}

function hasKnownGeneratedSenpiCompatibilityGuidance(content, compatibilityIndex) {
  return senpiCompatibilityEndMarkers.some((marker) => content.indexOf(marker, compatibilityIndex) !== -1)
}

export function insertSenpiCompatibilityGuidance(content) {
  if (!opencodeOnlyOrchestrationPattern.test(content)) return content
  const firstExampleIndex = content.search(opencodeOnlyOrchestrationPattern)
  const compatibilityIndex = content.indexOf("## Senpi Harness Tool Compatibility")
  if (
    compatibilityIndex !== -1 &&
    compatibilityIndex < firstExampleIndex &&
    !hasKnownGeneratedSenpiCompatibilityGuidance(content, compatibilityIndex)
  ) {
    return content
  }

  const contentWithoutGuidance = removeSenpiCompatibilityGuidance(content)

  const frontmatterMatch = contentWithoutGuidance.match(/^---\n[\s\S]*?\n---\n+/)
  if (!frontmatterMatch) {
    return `${senpiHarnessToolCompatibility}${contentWithoutGuidance}`
  }

  return `${frontmatterMatch[0]}${senpiHarnessToolCompatibility}${contentWithoutGuidance.slice(frontmatterMatch[0].length)}`
}
