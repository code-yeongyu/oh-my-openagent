export const HYPERPLAN_TEMPLATE = `You are running the \`/hyperplan\` command — adversarial multi-agent planning via team-mode.

LOAD THE HYPERPLAN SKILL IMMEDIATELY:

\`\`\`
skill(name="hyperplan")
\`\`\`

After loading the skill, follow its 6-phase workflow EXACTLY using this user request:

<user-request>
$ARGUMENTS
</user-request>

If team-mode is unavailable (\`team_*\` tools missing), instruct the user to set \`team_mode.enabled: true\` in \`~/.config/opencode/oh-my-opencode.jsonc\` and restart opencode.`
