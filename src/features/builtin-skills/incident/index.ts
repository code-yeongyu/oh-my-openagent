import type { BuiltinSkill } from "../types"

export const incidentSkillTemplate = `# Incident Management Skill

Enterprise incident response for on-call workflows, incident coordination, and postmortems.

## Commands

- \`/incident start <title>\` - Declare a new incident
- \`/incident update <id>\` - Update incident status
- \`/incident resolve <id>\` - Resolve an incident
- \`/incident postmortem <id>\` - Generate postmortem document
- \`/incident oncall [schedule]\` - Show who's on-call

## Incident Lifecycle

### 1. Start an Incident

\`\`\`
/incident start "API latency spike" --severity SEV2 --service api-gateway
/incident start "Database connection failures" --severity SEV1 --assignee @oncall
\`\`\`

Creates incident in PagerDuty, notifies on-call, and establishes communication channels.

### 2. Update Status

\`\`\`
/incident update INC-123 --status investigating --message "Identified high CPU on db-primary"
/incident update INC-123 --status identified --message "Root cause: connection pool exhaustion"
/incident update INC-123 --status monitoring --message "Fix deployed, monitoring metrics"
\`\`\`

Status progression: \`investigating\` → \`identified\` → \`monitoring\` → \`resolved\`

### 3. Resolve

\`\`\`
/incident resolve INC-123 --resolution "Increased connection pool size" --root-cause "Traffic spike exceeded pool capacity"
\`\`\`

### 4. Generate Postmortem

\`\`\`
/incident postmortem INC-123 --template blameless
\`\`\`

Templates:
- **basic**: Summary, timeline, resolution
- **detailed**: Full analysis with metrics, logs, action items
- **blameless**: Focus on system improvements, no individual blame

## Severity Levels

| Level | Response Time | Description |
|-------|---------------|-------------|
| SEV1 | Immediate | Complete outage, data loss risk |
| SEV2 | 15 minutes | Major feature unavailable |
| SEV3 | 1 hour | Degraded service, workaround exists |
| SEV4 | 4 hours | Minor issue, low impact |

## On-Call Management

\`\`\`
/incident oncall                    # Show current on-call
/incident oncall --schedule primary # Show specific schedule
/incident oncall --time "2026-01-10 09:00" # Who's on-call at time
\`\`\`

## Integrations

### PagerDuty

Set environment variables:
- PAGERDUTY_API_KEY: Your PagerDuty API key
- PAGERDUTY_SERVICE_ID: Default service ID (optional)
- PAGERDUTY_ESCALATION_POLICY_ID: Default escalation policy (optional)

Get API key: https://support.pagerduty.com/docs/api-access-keys

### Slack (for notifications)

Set environment variables:
- SLACK_BOT_TOKEN: Slack bot token (xoxb-...)
- SLACK_INCIDENT_CHANNEL: Default incident channel ID

## Postmortem Framework

Generated postmortems follow Google SRE blameless postmortem format:

1. **Summary**: What happened, impact, duration
2. **Timeline**: Chronological events with timestamps
3. **Root Cause**: Technical analysis
4. **Resolution**: How it was fixed
5. **Impact**: Users affected, data impact
6. **Lessons Learned**: What worked, what didn't
7. **Action Items**: Preventive measures with owners
`

export const incidentSkill: BuiltinSkill = {
  name: "incident",
  description: "Enterprise incident response for on-call workflows, incident coordination, status updates, and blameless postmortem generation.",
  template: incidentSkillTemplate,
  argumentHint: "start|update|resolve|postmortem|oncall [args]",
  mcpConfig: {
    pagerduty: {
      command: "uvx",
      args: ["pagerduty-mcp", "--enable-write-tools"],
      env: {
        PAGERDUTY_USER_API_KEY: "${PAGERDUTY_API_KEY}",
      },
    },
    slack: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: {
        SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}",
        SLACK_TEAM_ID: "${SLACK_TEAM_ID:-}",
      },
    },
  },
}

export * from "./types"
