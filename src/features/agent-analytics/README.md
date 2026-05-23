# Agent Performance Analytics

Captures and reports on agent performance metrics including tool execution timing, success rates, and token usage.

## Features

- **Tool Execution Metrics**: Tracks duration, success/failure, and token usage for each tool call
- **Agent Summaries**: Per-agent performance statistics
- **Trend Analysis**: Temporal trends for performance monitoring
- **CLI Integration**: `omo analytics` command for querying metrics

## Usage

```bash
# View overall summary
omo analytics summary

# View metrics for specific agent
omo analytics agent sisyphus

# View trends over time
omo analytics trends
```

## Architecture

- **Hook**: `src/hooks/agent-analytics.ts` - Captures tool execution events
- **Storage**: SQLite with WAL mode for high concurrency
- **Reports**: `src/features/agent-analytics/reports.ts` - Metric aggregation and formatting

## Data Model

Metrics are stored in `agent_metrics` table with fields:
- `id`: Unique identifier
- `agent_name`: Agent that executed the tool
- `tool_name`: Tool that was executed
- `category`: Task category (quick, research, etc.)
- `session_id`: Session identifier
- `duration_ms`: Execution duration in milliseconds
- `token_count`: Token usage (if available)
- `success`: Whether execution succeeded
- `error_type`: Type of error (if failed)
- `model_used`: Model used for execution
- `executed_at`: Timestamp
