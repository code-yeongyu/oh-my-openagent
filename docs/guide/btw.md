# `/btw` Command

Use `/btw` when you want to ask a side question without affecting future model-request context in the same conversation.

## Usage

```text
/btw <question>
```

Example:

```text
/btw What does this error message mean?
```

## What It Does

`/btw` sends one side question to the current session model and returns one inline answer. It is for quick checks, definitions, or side explanations that shouldn't shape later turns.

The `/btw` question and answer are removed from future model-request payloads. They do not consume future token budget and the model does not remember them on subsequent turns.

## Constraints

- Read-only answer turn. Tools are blocked while `/btw` is answering.
- Single response only. There is no multi-turn `/btw` thread.
- Uses the same model as the current session.
- Primary interactive session only.
- Not available in subagent, team-mode, or background sessions.

## Scope and Visibility

`/btw` changes future model-request payloads, not the visible session record. The question and answer remain visible in the session history and may remain in session storage.

It is not a secrecy feature. Use it for context control, not for sensitive material.

## Compaction Caveat

If the session is compacted, the compaction summary may retain `/btw` content, since compaction does not route through the same message-stripping pipeline.

## Disable It

Disable the command with `disabled_commands` in your oh-my-openagent config:

```jsonc
{
  "disabled_commands": ["btw"]
}
```
