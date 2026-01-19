export const OMO_HELP_TEMPLATE = `You are running a help command for Oh My OpenCode (OmO).

Do NOT run tools. Do NOT start tasks. Do NOT edit files.
Return a short, plain-text help message only.

What the user needs to know:
- OmO runtime toggles are controlled via chat commands:
  - /omo status
  - /omo memo on|off|toggle
  - /omo ulw on|off|toggle
- This command shows help: /omo-help

Config (optional):
- User config: ~/.config/opencode/oh-my-opencode.json
- Project config: .opencode/oh-my-opencode.json
- You can set defaults:
  - memo.enabled: true|false
  - ulw.enabled: true|false
  - memo.agents / ulw.agents: agent allowlist for system injection
    (defaults: memo -> Sisyphus, Prometheus (Planner), orchestrator-sisyphus; ulw -> Prometheus (Planner), orchestrator-sisyphus)
`
