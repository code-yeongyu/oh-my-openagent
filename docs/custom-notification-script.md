# Custom Notification Script

oh-my-opencode can run a custom notification script after its built-in desktop notification.

## Configuration

Add to your `~/.omo/omo.jsonc`:

```json
{
  "[opencode]": {
    "notification": {
      "force_enable": true,
      "script": "~/.config/opencode/notification.sh"
    }
  }
}
```

## Script Interface

Your script will receive:

1. **First argument**: Hook type (`idle`, `permission`, `question`)
2. **stdin**: JSON data with notification context
3. **Environment variables**:
   - `OPENCODE_PROJECT_DIR`: Current project directory
   - `OPENCODE_SESSION_ID`: Session ID

### JSON Input Format

```json
{
  "type": "idle",
  "sessionID": "session-id",
  "projectDir": "/path/to/project",
  "title": "OpenCode",
  "message": "Agent is ready for input"
}
```

## Example Script

See `examples/notification.sh` for a minimal example that logs the hook type and JSON payload.

## Hook Types

- `idle`: Session is idle and ready for input
- `permission`: Agent needs permission to continue
- `question`: Agent is asking a question

The built-in platform notification runs first. Script failures are logged and do not interrupt the session.
