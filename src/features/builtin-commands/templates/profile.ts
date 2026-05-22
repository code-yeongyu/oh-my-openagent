export const PROFILE_TEMPLATE = `# /profile Command

## Usage

\`\`\`
/profile                  → List available profiles and show current
/profile list            → List available profiles
/profile show            → Show currently active profile
/profile set <name>      → Change profile (edits project config, instructs to start new session)
/profile set <name> --global  → Change profile globally (~/.config/opencode/matrixx.jsonc)
/profile set <name> --project → Change profile project-scoped (.opencode/matrixx.jsonc)
\`\`\`

## Available Profiles

| Profile | Description | Key Characteristic |
|---------|-------------|-------------------|
| free | Zero-cost, uses only free/open models | Kimi K2.5 Free, Grok (free), GLM |
| budget | Cost-optimized for tight budgets | Sonnet/Haiku mix, no Opus |
| economy | Balanced cost and capability | Primarily Sonnet/Haiku |
| balanced | Default — best overall value | Opus/Sonnet/Haiku tiered |
| performance | Maximum quality, no compromises | Opus for all heavy agents |
| go | Premium OpenCode Go subscription | Kimi K2.6, DeepSeek V4 Pro, GLM 5.1 |

## How It Works

Each profile sets the \`model\` field on every agent and category in Matrixx's configuration. When you switch profiles, the agent models are swapped accordingly.

The profile name is stored in your \`matrixx.json\` or \`matrixx.jsonc\` config file. On the next session, Matrixx reads it and applies the profile's model mapping, merging it with any explicit per-agent overrides you may have set.

## Task: Change the Profile

Follow these steps:

### Step 1: Know the Current Config Location

Matrixx reads config from two locations (user config wins over project config):
- **Project**: \`.opencode/matrixx.json\` or \`.opencode/matrixx.jsonc\`
- **Global**: \`~/.config/opencode/matrixx.json\` or \`~/.config/opencode/matrixx.jsonc\`

### Step 2: Determine Which Config File to Edit

- \`--global\` → Edit \`~/.config/opencode/matrixx.jsonc\`
- \`--project\` (default) → Edit \`.opencode/matrixx.jsonc\`
- If no flag and neither file exists, use \`--project\`

### Step 3: Read the Target Config File

Use the \`read\` tool to read the config file.

### Step 4: Validate the Requested Profile

If the user asked for \`/profile set <name>\`, verify \`<name>\` is in the table above. If not, report the valid profiles and stop.

### Step 5: Update the \`profile\` Key

Set \`"profile": "<name>"\` in the config JSON. If the \`profile\` key already exists, update it. If it doesn't exist, add it at the top level. Do NOT modify any other keys.

### Step 6: Write the Config File Back

Use the \`write\` tool (or \`edit\` tool for minimal changes) to save the updated config.

### Step 7: Confirm and Advise

Tell the user:
1. The profile has been changed to \`<name>\`
2. For the change to take effect, they MUST start a new session (\`/new\` or restart OpenCode)
3. If they want session-level switching without restarting, suggest using the profile with \`--global\` or \`--project\` as appropriate

### Step 8: If \`/profile\` Was Called Without Arguments

Just list the available profiles and show the current configuration's profile value.`
