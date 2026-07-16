# OpenViking Integration for OMO

OpenViking integration for OMO (oh-my-openagent) plugin that provides automatic memory recall and session commit capabilities, reducing token consumption by 50-80% and preventing TPM rate limiting.

## Features

- **Automatic Memory Recall**: Before each AI call, automatically recalls relevant memories from OpenViking and injects them into the conversation context
- **Automatic Session Commit**: When a session ends, automatically commits the conversation history to OpenViking for memory extraction and L0/L1 summary generation
- **Session Compaction Integration**: Integrates with OpenCode's session compaction process to generate structured summaries
- **Graceful Degradation**: If OpenViking is unavailable, the system continues to work normally without memory features
- **Configurable**: Fine-grained control over memory types, count limits, and auto-recall/commit behavior

## Installation

### Prerequisites

1. **OpenViking Server**: You need to deploy an OpenViking Server instance. See [OpenViking Documentation](https://github.com/volcengine/OpenViking) for deployment instructions.

2. **Python 3.10+**: Required for OpenViking Server.

3. **Model Services**: OpenViking requires:
   - VLM model (for generating L0/L1 summaries)
   - Embedding model (for vector retrieval)
   
   You can use:
   - Local models via Ollama
   - Cloud services like SiliconFlow (Qwen3-Embedding-8B: ¥0.04/M tokens)
   - Volcengine Doubao models

### Setup

1. **Deploy OpenViking Server**:

```bash
# Install OpenViking
pip install openviking

# Initialize configuration
openviking-server init

# Verify configuration
openviking-server doctor

# Start server
openviking-server
```

2. **Configure OMO Plugin**:

Add the following to your `~/.config/opencode/oh-my-openagent.json`:

```json
{
  "openviking": {
    "enabled": true,
    "url": "http://localhost:1933",
    "api_key": "",
    "auto_recall": true,
    "auto_commit": true,
    "max_memories": 5,
    "memory_types": ["preferences", "patterns", "tools"]
  }
}
```

3. **Restart OpenCode**:

Restart OpenCode to load the new configuration.

## Configuration

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable OpenViking integration |
| `url` | string | `"http://localhost:1933"` | OpenViking server URL |
| `api_key` | string | `""` | API key for authentication (optional) |
| `auto_recall` | boolean | `true` | Automatically recall memories before AI calls |
| `auto_commit` | boolean | `true` | Automatically commit sessions when they end |
| `max_memories` | integer | `5` | Maximum number of memories to recall (1-20) |
| `memory_types` | array | `undefined` | Memory types to recall (all types if not specified) |

### Memory Types

Available memory types:

- `profile`: User identity and attributes
- `preferences`: User preferences by topic
- `entities`: Entity memories (people, projects)
- `events`: Event records (decisions, milestones)
- `cases`: Problem + solution pairs
- `patterns`: Reusable workflows
- `tools`: Tool usage experience and best practices
- `skills`: Skill execution experience and workflow strategies

### Example Configurations

**Minimal Configuration**:

```json
{
  "openviking": {
    "enabled": true
  }
}
```

**Custom Configuration**:

```json
{
  "openviking": {
    "enabled": true,
    "url": "https://openviking.example.com",
    "api_key": "your-api-key",
    "auto_recall": true,
    "auto_commit": true,
    "max_memories": 10,
    "memory_types": ["preferences", "patterns"]
  }
}
```

**Disable Auto-Recall**:

```json
{
  "openviking": {
    "enabled": true,
    "auto_recall": false,
    "auto_commit": true
  }
}
```

## Usage

### How It Works

1. **Memory Recall** (before each AI call):
   - Extracts the last user message as a query
   - Calls OpenViking's recall API to find relevant memories
   - Injects memories into the conversation context as a synthetic message part
   - AI has access to relevant context from previous sessions

2. **Session Commit** (when session ends):
   - Tracks all messages in the session
   - Commits the complete session history to OpenViking
   - OpenViking extracts memories and generates L0/L1 summaries asynchronously
   - Memories are available for future recall

3. **Session Compaction** (during compaction):
   - Integrates with OpenCode's compaction process
   - Generates structured summaries using OpenViking
   - Preserves recent context (last 10% of messages)
   - Falls back to default compaction if OpenViking is unavailable

### Memory Recall Format

Memories are injected into the conversation in the following format:

```
<openviking-memories>
[Preferences] User prefers TypeScript over JavaScript

[Patterns] Always write tests before implementation

[Tools] Use pytest for Python testing, Jest for JavaScript
</openviking-memories>

[Original user message...]
```

## Troubleshooting

### OpenViking Server Not Reachable

**Symptom**: Warning logs like "Memory recall network error, skipping injection"

**Solution**:
1. Check if OpenViking Server is running: `openviking-server doctor`
2. Verify the URL in your configuration
3. Check firewall settings
4. Ensure the server is listening on the correct port

### Memory Recall Timeout

**Symptom**: Warning logs like "Memory recall timed out, skipping injection"

**Solution**:
1. Check OpenViking Server performance
2. Reduce `max_memories` in configuration
3. Filter memory types to reduce search scope
4. Ensure Embedding model is responsive

### Session Commit Failure

**Symptom**: Error logs like "Session commit API error"

**Solution**:
1. Check OpenViking Server logs for errors
2. Verify API key if authentication is enabled
3. Check server resources (memory, disk space)
4. Restart OpenViking Server

### No Memories Recalled

**Symptom**: Info logs like "No memories found"

**Solution**:
1. Ensure sessions are being committed (check `auto_commit` is enabled)
2. Wait for memory extraction to complete (async process)
3. Check OpenViking Server logs for extraction errors
4. Verify memory types in configuration match extracted memories

## Performance Impact

### Latency

- **Memory Recall**: Adds 0.5-2s latency per AI call (configurable timeout: 2s)
- **Session Commit**: Adds 2-10s latency when session ends (async processing)
- **Session Compaction**: Minimal impact (uses existing compaction process)

### Token Consumption

- **Before**: Token consumption grows linearly with conversation length
- **After**: Token consumption reduced by 50-80% through:
  - Memory recall instead of full history
  - Session compaction with structured summaries
  - L0/L1 hierarchical context loading

### Resource Usage

- **OpenViking Server**: Requires Python 3.10+, VLM model, Embedding model
- **Network**: HTTP requests to OpenViking Server (localhost recommended)
- **Storage**: OpenViking stores memories and session history

## Development

### Project Structure

```
packages/omo-opencode/src/
├── config/
│   ├── schema/
│   │   ├── openviking.ts          # OpenViking configuration schema
│   │   ├── openviking.test.ts     # Configuration tests
│   │   └── oh-my-opencode-config.ts  # Main config with OpenViking
│   └── schema.ts                  # Schema exports
├── features/
│   └── openviking/
│       ├── types.ts               # Type definitions
│       ├── client.ts              # OpenViking client
│       ├── client.test.ts         # Client tests
│       ├── memory-recall.ts       # Memory recall hook
│       ├── session-commit.ts      # Session commit hook
│       └── compaction.ts          # Session compaction hook
├── hooks/
│   └── openviking.ts              # Hook registration
└── create-hooks.ts                # Main hook creation
```

### Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test packages/omo-opencode/src/config/schema/openviking.test.ts
bun test packages/omo-opencode/src/features/openviking/client.test.ts
```

### Building

```bash
# Build the project
bun run build

# Type check
bun run typecheck
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

This project is part of the OMO (oh-my-openagent) plugin and follows the same license.

## Related Projects

- [OMO (oh-my-openagent)](https://github.com/code-yeongyu/oh-my-openagent) - The main OMO plugin
- [OpenViking](https://github.com/volcengine/OpenViking) - Context database for AI agents
- [OpenCode](https://opencode.ai/) - AI coding assistant

## Support

For issues and questions:

- Open an issue on [GitHub](https://github.com/code-yeongyu/oh-my-openagent/issues)
- Join the [Discord community](https://discord.gg/PUwSMR9XNk)
- Check the [OMO documentation](https://omo.vibetip.help/docs)
