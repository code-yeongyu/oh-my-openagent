export const HYPERPLAN_TEMPLATE = `You are running the \`/hyperplan\` command — adversarial multi-agent planning via team-mode.

LOAD THE HYPERPLAN SKILL IMMEDIATELY:

\`\`\`
skill(name="hyperplan")
\`\`\`

After loading the skill, follow its 7-phase workflow EXACTLY using this user request.

Roster contract: call \`team_create\` with category members \`unspecified-low\`, \`unspecified-high\`, \`ultrabrain\`, and \`artistry\`. Include \`deep\` only if the category is enabled; if \`deep\` is disabled or unavailable, retry without only that member and state the degraded roster.

<user-request>
$ARGUMENTS
</user-request>

If team-mode is unavailable (\`team_*\` tools missing), instruct the user to set \`team_mode.enabled: true\` in \`~/.config/opencode/oh-my-opencode.jsonc\` and restart opencode.`
