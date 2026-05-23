# Auto-Evaluation

Automatic evaluation system that scores agent session quality and provides feedback for improvement.

## Features

- **Session Evaluation**: Automatic scoring based on completion, quality, and efficiency
- **Agent Scoring**: Per-agent performance tracking with trends
- **Heuristic-Based**: Uses task completion, error rates, and tool usage for scoring
- **CLI Integration**: `omo evaluation` command for viewing scores

## Usage

```bash
# View evaluation statistics
omo evaluation stats

# View score for specific agent
omo evaluation agent sisyphus

# View recent evaluations
omo evaluation recent

# Clear all evaluations
omo evaluation clear
```

## Architecture

- **Hook**: `src/hooks/auto-evaluation.ts` - Evaluates sessions on completion
- **Storage**: SQLite for evaluation data
- **Scoring**: Heuristic-based scoring algorithm
- **Trends**: Detects improving/stable/declining performance

## Scoring Algorithm

Evaluations are scored on three dimensions (0-100 each):
- **Completion**: Percentage of todos completed
- **Quality**: Inverse of error count (100 - errors * 10)
- **Efficiency**: Inverse of tool call overhead (100 - (toolCalls / 10) * 5)

Overall score is the average of the three dimensions.

## Data Model

Evaluations are stored in `evaluations` table with fields:
- `id`: Unique identifier
- `session_id`: Session identifier
- `agent_name`: Agent that was evaluated
- `completion_score`: Completion score (0-100)
- `quality_score`: Quality score (0-100)
- `efficiency_score`: Efficiency score (0-100)
- `overall_score`: Average of all scores
- `error_count`: Number of errors
- `tool_call_count`: Number of tool calls
- `duration_ms`: Session duration
- `category`: Task category
- `evaluated_at`: Timestamp
