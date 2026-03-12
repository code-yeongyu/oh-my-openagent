# Custom Notification Script

oh-my-opencode now supports custom notification scripts, compatible with Claude Code hooks system.

## Configuration

Add to your `~/.config/opencode/oh-my-opencode.json`:

```json
{
  "notification": {
    "force_enable": true,
    "script": "~/.config/opencode/notification.sh"
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

See `examples/notification.sh` for a complete example that:
- Displays system notifications with project directory in title
- Plays a custom sound
- Logs debug information to `/tmp/opencode-notification-debug.log`

## Hook Types

- `idle`: Session is idle and ready for input
- `permission`: Agent needs permission to continue
- `question`: Agent is asking a question

## Backward Compatibility

If you don't configure a custom script, the built-in notification system will be used. You can still configure:

```json
{
  "notification": {
    "force_enable": true,
    "playSound": true,
    "soundPath": "/path/to/sound.wav"
  }
}
```
