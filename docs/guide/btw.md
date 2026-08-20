# BTW Side Conversations

`/btw` opens a temporary side conversation without interrupting or adding
messages to the main conversation.

Use it while the main agent is working when you need a quick explanation,
status check, or related question:

```text
/btw what is the risky part of this migration?
```

`/side` is an alias:

```text
/side explain the current test failure
```

Entering `/btw` without a question opens an empty side conversation. Type the
question after the side view appears.

## What happens

1. OMO records a stable message boundary in the current conversation.
2. The TUI creates a visually empty temporary session with the same model and
   agent.
3. The model receives the most recent main-conversation context through that
   boundary as read-only background, capped at 64 messages and 64 KiB. The
   inherited messages are not written into the side transcript.
4. The main conversation keeps running independently.
5. Closing BTW aborts any active side turn and deletes the temporary session.

The side question and answer never enter the main session. Returning to the
main session shows the same transcript and task state it had before BTW opened.

## Controls

| Action | Control |
| --- | --- |
| Start with a question | `/btw <question>` |
| Start with an empty composer | `/btw` |
| Alias | `/side [question]` |
| Switch between main and BTW | `Ctrl+/` |
| Close BTW from an empty side composer | `Ctrl+C` |

Terminals that encode `Ctrl+/` as `Ctrl+_` are supported automatically.

The prompt status area reports these states:

- `BTW starting...`
- `BTW open · ctrl+/ switch`
- `BTW from main · main working · ctrl+/ switch · ctrl+c close`
- `BTW closing...`

`main working` changes to `main ready`, `main needs input`, or
`main needs permission` as the parent session changes.

## Boundaries

- BTW is available after the current session has at least one stable message.
- BTW drafts are text-only. If the composer has an attachment, remove it before
  starting BTW; the parent draft and attachment remain untouched.
- Only one BTW conversation can be open at a time.
- A BTW conversation cannot open another BTW conversation.
- File and external-state changes are discouraged unless the side request asks
  for them explicitly.
- Side conversations do not delegate work to subagents.

OpenAI Codex can present its side thread inside the native Codex TUI. OpenCode's
plugin API does not expose that split presentation, so OMO uses a dedicated
session route and `Ctrl+/` switching while preserving the same isolation and
temporary-session behavior.

If OpenCode exits unexpectedly, the metadata-marked BTW session can remain in
the session list. Delete it like any other abandoned session. Reattaching to a
BTW session briefly shows `BTW from main · reattaching...` while parent metadata
loads.
