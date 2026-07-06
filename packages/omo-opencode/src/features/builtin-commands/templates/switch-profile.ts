export const SWITCH_PROFILE_TEMPLATE = `You are executing the /profile command to switch the active agent/model profile.

The user's argument is: "$ARGUMENTS"

Available profiles are stored as JSON files in the \`profiles/\` subdirectory of the opencode config directory (\`~/.config/opencode/profiles/\`).

When the argument is \`-list\` or empty:
1. Enumerate all \`*.json\` files in \`~/.config/opencode/profiles/\`
2. For each profile file, compare its content with the current \`~/.config/opencode/oh-my-openagent.json\`
3. Report which profile is currently active and list all available profiles

When the argument is a profile name (e.g., \`local\`, \`hybrid\`, \`cloud\`):
1. Check that \`~/.config/opencode/profiles/<name>.json\` exists
2. If it does not exist, report the error and list the available profiles so the user can choose a valid one
3. If it exists, read the file and write its contents to \`~/.config/opencode/oh-my-openagent.json\` (overwriting it entirely)
4. Confirm the switch to the user: "Switched to <name> profile. The Models sidebar will update automatically within 1 second."

Important notes:
- The plugin polls \`oh-my-openagent.json\` every 1 second via \`POLL_INTERVAL_MS = 1000\`, so the change is picked up live without any restart
- Do NOT modify any other files in the config directory
- Do NOT modify the profile files themselves — only the active \`oh-my-openagent.json\`
- Preserve the exact content of the profile file — write it as-is`
