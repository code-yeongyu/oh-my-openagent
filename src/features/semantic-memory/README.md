# Semantic Memory

Cross-session context retrieval system that allows agents to "remember" important context from previous sessions.

## Features

- **Memory Storage**: Store context, decisions, errors, and patterns
- **Vector Search**: Find relevant memories using cosine similarity
- **Importance Scoring**: Memories are ranked by importance and access frequency
- **CLI Integration**: `omo memory` command for memory management

## Usage

```bash
# Search for relevant memories
omo memory search "authentication flow"

# View recent memories
omo memory recent

# Store a memory manually
omo memory store "Important decision about auth"

# Clear all memories
omo memory clear
```

## Architecture

- **Hook**: `src/hooks/semantic-memory.ts` - Captures session context automatically
- **Storage**: SQLite with vector search
- **Embeddings**: Hash-based frequency vectors (128-dim)
- **Search**: Cosine similarity with importance weighting

## Data Model

Memories are stored in `memories` table with fields:
- `id`: Unique identifier
- `content`: Memory content
- `embedding`: 128-dimensional vector (JSON)
- `memory_type`: Type (context, decision, error, pattern, insight)
- `agent_name`: Agent that created the memory
- `session_id`: Session identifier
- `importance`: Importance score (1.0-5.0)
- `access_count`: Number of times accessed
- `created_at`: Timestamp

## Limitations

- Embeddings are hash-based (not semantic) to avoid external dependencies
- Full-table scan for search (acceptable for small datasets)
- No automatic memory decay/expiration
