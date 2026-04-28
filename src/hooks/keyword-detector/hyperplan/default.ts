/**
 * Hyperplan keyword detector.
 *
 * Triggers when the user wants adversarial multi-agent planning via team-mode.
 *
 * Triggers (case-insensitive, word-bounded):
 * - English: hyperplan, hpp
 *
 * The detector injects a thin wrapper that loads the `hyperplan` skill, which
 * carries the full orchestration instructions for the 5-member adversarial team.
 */

export const HYPERPLAN_PATTERN = /\b(hyperplan|hpp)\b/i

export const HYPERPLAN_MESSAGE = `<hyperplan-mode>
**MANDATORY**: Say "HYPERPLAN MODE ENABLED!" as your first response, exactly once.

The user invoked **hyperplan mode** — adversarial multi-agent planning via team-mode.

LOAD THE HYPERPLAN SKILL IMMEDIATELY:

\`\`\`
skill(name="hyperplan")
\`\`\`

After loading, follow the skill's 6-phase workflow EXACTLY:
1. Acknowledge and capture the planning request
2. Spawn the 5-member adversarial team via team_create
3. Round 1 — Independent analysis (each member produces findings)
4. Round 2 — Cross-attack (each member ruthlessly attacks the other 4's findings)
5. Round 3 — Defend, refine, or concede
6. Synthesize defensible insights into a work plan + clean up the team

Do NOT improvise. Do NOT skip rounds. Be the lead orchestrator and let the adversarial members do the cross-critique.

If team-mode is unavailable (\`team_*\` tools missing), instruct the user to set \`team_mode.enabled: true\` in \`~/.config/opencode/oh-my-opencode.jsonc\` and restart opencode.
</hyperplan-mode>`
