# BTW Side Conversations

`/btw` opens retained side conversations without interrupting or adding
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

Entering `/btw` without a question opens the BTW picker. The picker summarizes
the main conversation and every retained side, then lets you open one or create
a new empty side.

## What happens

1. OMO records a stable message boundary in the current conversation.
2. The TUI creates a visually empty retained session with the same model and
   agent.
3. The model receives the most recent main-conversation context through that
   boundary as read-only background, capped at 64 messages and 64 KiB. The
   inherited messages are not written into the side transcript.
4. The main conversation keeps running independently.
5. Returning with `Esc Esc` keeps the side available. Destructive `Ctrl+C`
   aborts the visible side turn and deletes only that side.

The side question and answer never enter the main session. Returning to the
main session shows the same transcript and task state it had before BTW opened.
Each later `/btw <question>` creates another side instead of reusing an earlier
one. Starting BTW while viewing a side creates a sibling under the same main
conversation.

## Controls

| Action | Control |
| --- | --- |
| Create a new side with a question | `/btw <question>` |
| Open the session picker | `/btw` |
| Alias | `/side [question]` |
| Open the picker from any related view | `Ctrl+/` |
| Return to Main without deletion | `Esc Esc` |
| Delete the visible side from an empty composer | `Ctrl+C` |

Terminals that encode `Ctrl+/` as `Ctrl+_` or `Ctrl+7` are supported
automatically.

The picker has three sections:

- **Main conversation** opens the original transcript.
- **Retained BTW sessions** lists `BTW #1`, `BTW #2`, and later sides
  oldest-first with question summaries.
- **Actions** contains **New BTW**.

The current destination is selected when the picker opens. Both the picker and
long BTW transcripts use native mouse-wheel scrolling.

The prompt status area reports these states:

- `BTW starting...`
- `BTW retained · ctrl+/ picker`
- `BTW #2 · main working · esc esc return · ctrl+/ picker · ctrl+c delete`
- `BTW closing...`

`main working` changes to `main ready`, `main needs input`, or
`main needs permission` as the parent session changes.

## Boundaries

- BTW is available after the current session has at least one stable message.
- BTW drafts are text-only. If the composer has an attachment, remove it before
  starting BTW; the parent draft and attachment remain untouched.
- Multiple BTW conversations can be retained under one main conversation.
- Starting from a BTW view creates a sibling side, never a nested side.
- File and external-state changes are discouraged unless the side request asks
  for them explicitly.
- Side conversations do not delegate work to subagents.

OpenAI Codex can present its side thread inside the native Codex TUI. OpenCode's
plugin API does not expose that split presentation, so OMO uses retained
session routes and a native picker while preserving the same transcript
isolation.

Retained BTW sessions survive TUI reloads. Reattaching briefly shows
`BTW from main · reattaching...` while parent metadata loads. Use `Ctrl+C` from
an empty side composer when you want to delete that side.
