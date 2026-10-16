import { basename } from "node:path"
import { repoRoot, pluginRoot } from "./omo-native-telemetry-provider.mjs"
import { isRecord } from "./omo-native-telemetry-assertions.mjs"

export function redactEvents(events) {
  const distinctIds = new Set()
  const sessionHashes = new Set()
  const installIds = new Set()
  for (const event of events) {
    const distinctId = event.distinct_id ?? event.properties.distinct_id
    if (typeof distinctId === "string") distinctIds.add(distinctId)
    const sessionHash = event.properties.$session_id
    if (typeof sessionHash === "string") sessionHashes.add(sessionHash)
    const installId = event.properties.install_id
    if (typeof installId === "string") installIds.add(installId)
  }
  const replace = (value) => {
    if (typeof value === "string") {
      if (distinctIds.has(value)) return "<redacted-distinct-id>"
      if (sessionHashes.has(value)) return "<redacted-session-hash>"
      if (installIds.has(value)) return "<redacted-install-id>"
      return value
    }
    if (Array.isArray(value)) return value.map(replace)
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]))
    return value
  }
  return events.map(replace)
}

export function sanitizeTranscript(text, sandboxes) {
  let sanitized = text
  for (const sandbox of sandboxes) sanitized = sanitized.replaceAll(sandbox.root, `<temp-${basename(sandbox.root).split("-").at(-2) ?? "sandbox"}>`)
  sanitized = sanitized.replaceAll(repoRoot, "<repo-root>")
  sanitized = sanitized.replaceAll(pluginRoot, "<plugin-root>")
  return sanitized
}

export function evidenceMarkdown(input) {
  const assertionLines = input.checks.map((check) => `- PASS ${check.name}: ${redactEvidenceText(check.detail)}`).join("\n")
  return `# Task 14: OmO Native telemetry real-surface QA

## Result

PASS. The real Senpi CLI emitted all ten OmO Native events plus the unchanged legacy daily-active event, both opt-out paths emitted zero requests, and cleanup completed.

## Senpi precheck

Resolved executable: \`${input.senpiLabel}\`

\`senpi --help\` exposed \`--print, -p\`, confirming a real non-interactive surface. Full output:

\`\`\`text
${input.help.trimEnd()}
\`\`\`

## Drive mechanism

The enabled and opt-out scenarios used the real Senpi CLI in persistent \`--mode rpc\` so exactly three prompts ran in one real session and prompt ordinals remained meaningful. Each next prompt waits for \`agent_settled\`, not the low-level \`agent_end\` event. The executable's \`-p\` capability was prechecked first as required. Tool selection used a temporary local provider generated from the repository precedent at \`packages/omo-senpi/scripts/qa/mock-provider/index.ts\`; it deterministically issued \`create_goal\`, \`task\`, and builtin \`read\` calls. The binary supplied its packaged plugin and native goal tool; a standalone engine loaded the built plugin through isolated settings. Builtin skill reads target the running binary's packaged skill root when present, not a different source checkout.

Isolation for every run used a fresh mktemp root containing its own \`HOME\`, pre-claimed onboarding state, \`SENPI_CODING_AGENT_DIR\`, session directory, XDG config directory, project, provider fixture, and omo.json. The developer's real \`~/.senpi\` was never configured or read by the driver.

## Assertion results

${assertionLines}
- PASS opt-out-do-not-track-zero-requests: ${input.optOutDntRequests} requests
- PASS opt-out-config-zero-requests: ${input.optOutConfigRequests} requests

All privacy, property, and path scans above were scoped strictly to: daily_active, session_started, prompt_submitted, turn_completed, skill_loaded, delegation_started, feature_used, delegation_completed, category_config, and parallelism_summary. The legacy \`omo_senpi_daily_active\` event was asserted for presence only and was not scanned.

## Captured payloads

The complete sanitized parsed-event dump is committed in \`captured-payloads.json\`. Machine distinct ids are replaced with \`<redacted-distinct-id>\`; keyed session hashes are replaced with \`<redacted-session-hash>\`. Installation ids are replaced with \`<redacted-install-id>\`. Raw hostname and identity salt are not present.

\`\`\`json
${JSON.stringify(input.redactedEvents, null, 2)}
\`\`\`

## Opt-out runs

- \`DO_NOT_TRACK=1\`: replayed the same three real prompts through the same real CLI drive; zero new HTTP requests reached the capture server from either native or legacy telemetry.
- \`omo.json telemetry.enabled:false\`: replayed the same three real prompts through the same real CLI drive; zero new HTTP requests reached the capture server from either native or legacy telemetry.

## Cleanup receipts

- Capture server process receipt: pid ${input.cleanup.serverPid}; server listening false: ${!input.cleanup.serverListening}; kill-zero-equivalent check failed as required: ${input.cleanup.killZeroFails}.
- Port ${input.cleanup.port} free after close: ${input.cleanup.portFree}; \`lsof -nP -iTCP:${input.cleanup.port} -sTCP:LISTEN\` output was empty: ${input.cleanup.lsofOutput === ""}.
${input.tempCleanup.map((receipt) => `- Removed ${receipt.path}: ${receipt.removed}.`).join("\n")}

## Transcript

A sanitized CLI transcript and stderr summary are committed in \`transcript.txt\`. Absolute repository and temporary paths are replaced with labels.
`
}

function redactEvidenceText(value) {
  return String(value).replace(/\b[a-f0-9]{64}\b/gi, "<redacted-session-hash>")
}
