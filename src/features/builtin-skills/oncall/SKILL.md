# On-Call Operations Skill

On-call management, alert handling, schedule management, and operational workflows for SRE and DevOps teams.

## Commands

### `/oncall status`

Show current on-call status, active alerts, and open incidents.

**Arguments:**
- `--schedule`: Specific schedule to check (default: all)
- `--detailed`: Include extended information

**Example:**
```
/oncall status
/oncall status --schedule primary
/oncall status --detailed
```

**Output:**
```
On-Call Status
==============
Primary: @john.doe (until 2026-01-04 09:00 PST)
Secondary: @jane.smith

Active Alerts: 2
  🔴 [CRIT] Database connection pool exhausted (5m ago)
  🟡 [HIGH] API latency > 500ms (12m ago)

Open Incidents: 1
  INC-456: Payment processing degraded (SEV2)
```

### `/oncall schedule [action]`

View or manage on-call schedules.

**Arguments:**
- `action` (optional): Schedule action: view, swap, override, create
- `--schedule`: Schedule name
- `--date`: Date to view/modify
- `--user`: User for swap/override
- `--duration`: Override duration

**Example:**
```
/oncall schedule
/oncall schedule view --date 2026-01-10
/oncall schedule swap --with @jane.smith --date 2026-01-05
/oncall schedule override --user @john.doe --duration 4h
```

### `/oncall escalate <reason>`

Escalate an alert or incident to the next level.

**Arguments:**
- `reason` (required): Reason for escalation
- `--alert`: Alert ID to escalate
- `--incident`: Incident ID to escalate
- `--level`: Target escalation level

**Example:**
```
/oncall escalate "Need database expertise" --alert ALR-123
/oncall escalate "Customer impact spreading" --incident INC-456 --level 2
```

### `/oncall acknowledge <target>`

Acknowledge an alert or incident.

**Arguments:**
- `target` (required): Alert or incident ID
- `--message`: Acknowledgment message

**Example:**
```
/oncall acknowledge ALR-123
/oncall acknowledge INC-456 --message "Investigating connection pool issue"
```

### `/oncall handoff <to>`

Hand off on-call responsibilities to another person.

**Arguments:**
- `to` (required): Person to hand off to
- `--notes`: Handoff notes
- `--active-items`: Include active alerts/incidents

**Example:**
```
/oncall handoff @jane.smith
/oncall handoff @jane.smith --notes "Database maintenance scheduled at 3pm"
/oncall handoff @jane.smith --active-items
```

### `/oncall runbook [search]`

Find and display runbooks for handling alerts.

**Arguments:**
- `search` (optional): Search term
- `--service`: Filter by service
- `--alert`: Get runbook for specific alert

**Example:**
```
/oncall runbook "database"
/oncall runbook --service payment-api
/oncall runbook --alert ALR-123
```

### `/oncall alerts [filter]`

List and filter alerts.

**Arguments:**
- `filter` (optional): Filter expression
- `--status`: Filter by status: triggered, acknowledged, resolved
- `--severity`: Filter by severity: critical, high, medium, low
- `--service`: Filter by service
- `--since`: Time range

**Example:**
```
/oncall alerts
/oncall alerts --status triggered --severity critical
/oncall alerts --service api-gateway --since 24h
```

### `/oncall metrics`

Show on-call metrics and statistics.

**Arguments:**
- `--schedule`: Specific schedule
- `--period`: Time period: day, week, month, quarter

**Example:**
```
/oncall metrics
/oncall metrics --period month
/oncall metrics --schedule primary --period quarter
```

## Integrations

### PagerDuty

Full PagerDuty integration for incident management.

**Environment variables:**
- `PAGERDUTY_API_KEY`: PagerDuty API key
- `PAGERDUTY_SERVICE_ID`: Default service ID (optional)
- `PAGERDUTY_ESCALATION_POLICY_ID`: Default escalation policy (optional)

Get API key: https://support.pagerduty.com/docs/api-access-keys

### OpsGenie

Atlassian OpsGenie integration.

**Environment variables:**
- `OPSGENIE_API_KEY`: OpsGenie API key
- `OPSGENIE_TEAM`: Default team (optional)

### VictorOps (Splunk On-Call)

VictorOps integration for on-call management.

**Environment variables:**
- `VICTOROPS_API_ID`: VictorOps API ID
- `VICTOROPS_API_KEY`: VictorOps API key

### Slack

Slack integration for notifications and handoffs.

**Environment variables:**
- `SLACK_BOT_TOKEN`: Slack bot token (xoxb-...)
- `SLACK_ONCALL_CHANNEL`: Default on-call channel

## Escalation Policies

Example escalation flow:
```
Level 1 (0-5 min):  Primary On-Call
Level 2 (5-15 min): Secondary On-Call
Level 3 (15-30 min): Team Lead + Engineering Manager
Level 4 (30+ min):  VP Engineering + Incident Commander
```

## Use Cases

### Start of Shift
```
/oncall status --detailed
/oncall alerts --status triggered
```

### Handling an Alert
```
/oncall acknowledge ALR-123 --message "Investigating"
/oncall runbook --alert ALR-123
```

### Need Help
```
/oncall escalate "Need DBA expertise" --alert ALR-123
```

### End of Shift
```
/oncall handoff @jane.smith --active-items --notes "Watch ALR-123, may need escalation"
```

### Shift Swap
```
/oncall schedule swap --with @john.doe --date 2026-01-15
```

### Performance Review
```
/oncall metrics --period month
```

## Best Practices

1. **Acknowledge quickly**: Reduces escalation noise
2. **Use runbooks**: Documented procedures save time
3. **Document handoffs**: Context is critical
4. **Escalate early**: When in doubt, escalate
5. **Review metrics**: Identify patterns and improvements
6. **Keep runbooks updated**: Update after every incident
