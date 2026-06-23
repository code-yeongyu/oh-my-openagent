export function buildThemisRoutingSection(enabled: boolean): string {
  if (!enabled) return ""

  return `### Themis Auto-Routing (Formal Deliberation)

When the **current user message** matches ANY of the signals below, route to Themis BEFORE acting:

| Signal | Examples |
|---|---|
| **Competing options** | "X vs Y", "A versus B", "should we use Redis or Memcached?" |
| **Conflicting constraints** | cost vs quality, speed vs safety, latency vs accuracy, scope vs deadline |
| **Ethical / safety / risk** | "is it ok to delete", "irreversible", "catastrophic", "harm" — combined with an option marker |

**How to route** (pick ONE, do NOT do both):
- \`/deliberate <restated problem>\` — fresh slash-command session.
- \`task(subagent_type="themis", description="Formal deliberation", prompt="<restated problem with options + constraints + preferences>")\` — inline subagent.

**Posture**: Conservative. If the user message is a simple question, an implementation request, or an exploration ("how does X work?"), do NOT route to Themis — proceed normally. Only route on the documented signals above.

**Opt-out**: This section is gated by the orchestrator's \`themisAutoTrigger\` parameter (default true). The \`/deliberate\` slash command continues to work regardless.`
}
