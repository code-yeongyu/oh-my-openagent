# QAing opencode hooks, actions, and events (Case B)

opencode publishes lifecycle events over Server-Sent Events. Plugins observe the SAME events via the `event` hook, so confirming an event on the wire proves a hook would fire. The bundled probe is `scripts/sse-hook-probe.sh`.

## Table of Contents

- [The two SSE endpoints](#the-two-sse-endpoints)
- [Watch the stream](#watch-the-stream)
- [Important event types](#important-event-types)
- [Hook-fired recipe (watch + trigger + assert)](#hook-fired-recipe-watch--trigger--assert)
- [Plugin hooks (the 21 hook points a plugin can implement)](#plugin-hooks-the-21-hook-points-a-plugin-can-implement)
- [Loading a local plugin for QA](#loading-a-local-plugin-for-qa)

## The two SSE endpoints

- GET /event?directory=<dir> - per-instance stream; the FIRST event is `server.connected`, a `server.heartbeat` arrives every 10s, and the stream ends on `server.instance.disposed`.
- GET /global/event - all events, no instance filter.
- Frames look like `data: {"type":"...","properties":{...}}` (one per line). Consume with `curl -N`.

## Watch the stream

```
curl -N -u opencode:$PASS "http://127.0.0.1:4096/event?directory=$PWD"
```

Bundled, with assertions + auto-teardown:

```
scripts/sse-hook-probe.sh --self-test
```

(spawns an isolated server, asserts server.connected)

```
scripts/sse-hook-probe.sh --attach http://127.0.0.1:4096 --password "$PASS" --directory "$PWD" --event message.part.updated --timeout 30
```

(watch your real server for a specific event)

## Important event types (type - properties)

- `session.created` / `session.updated` / `session.deleted` (sessionID, info)
- `message.updated` (sessionID, info)
- `message.removed` (sessionID, messageID)
- `message.part.updated` (sessionID, part, time)
- `message.part.delta` (sessionID, messageID, partID, field, delta)
- `message.part.removed`
- `permission.asked` (id, sessionID, permission, tool?)
- `permission.replied`
- `session.error` (sessionID?, error)
- `session.diff` (sessionID, diff)
- `question.asked` / `question.replied` / `question.rejected`
- `file.watcher.updated` (file, event)
- `project.updated`
- `lsp.updated`
- `pty.created` / `pty.updated` / `pty.exited` / `pty.deleted`
- `server.connected`
- `server.heartbeat`
- `server.instance.disposed`
- `global.disposed`
- `plugin.added`

## Hook-fired recipe (watch + trigger + assert)

Two-shell pattern (or use the script):

```
# shell 1: watch (kill with Ctrl-C when done)
curl -N -u opencode:$PASS "http://127.0.0.1:4096/event?directory=$PWD" \
  | grep --line-buffered '"type":"message.part.updated"'

# shell 2: trigger an action (fire-and-forget)
curl -X POST -u opencode:$PASS -H 'Content-Type: application/json' \
  -d '{"parts":[{"type":"text","text":"say hi"}]}' \
  "http://127.0.0.1:4096/session/<ses_id>/prompt_async?directory=$PWD"
```

A `message.part.updated` (text/tool) confirms the prompt action drove the model and any tool/permission hook path. Note: a real prompt requires a configured provider/auth, so this runs against your real server, not the isolated sandbox (the sandbox only proves the SSE plumbing via server.connected).

## Plugin hooks (the 21 hook points a plugin can implement)

`event`, `config`, `tool`, `auth`, `provider`, `chat.message`, `chat.params`, `chat.headers`, `permission.ask`, `command.execute.before`, `tool.execute.before`, `tool.execute.after`, `tool.definition`, `shell.env`, `experimental.chat.messages.transform`, `experimental.chat.system.transform`, `experimental.session.compacting`, `experimental.compaction.autocontinue`, `experimental.text.complete`.

- A plugin is a module default-exporting `{ id?, server: (input, options) => Promise<Hooks> }`.
- Minimal example implementing `event` and `tool.execute.before` that console.log the activity:

```typescript
export default {
  id: "qa-logger",
  async server(input, options) {
    return {
      event: async (event) => {
        console.log("[event]", event.type, event.properties);
      },
      "tool.execute.before": async (tool, args, context) => {
        console.log("[tool.before]", tool.name, args);
      },
    };
  },
};
```

## Loading a local plugin for QA

- Add an absolute path or npm spec to the opencode config `plugin` / `plugin_origins` array (project `.opencode/` config or user config), then restart opencode. On load it emits `plugin.added`.
- To QA a hook: load the plugin, watch /event (or the plugin's own logging), trigger the relevant action, and assert.

---

Pair this with references/server-api.md (how to start the server, auth, prompt routes).
