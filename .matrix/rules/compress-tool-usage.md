---
alwaysApply: true
description: "Correct usage of the compress tool to prevent 'content.startId is required' errors"
---

# compress Tool — Correct Parameter Format

The `compress` tool FAILS with `Error: content.startId is required and must be a non-empty string` when `content` is passed as a JSON-encoded string instead of a structured object.

## CORRECT Usage

Always pass `content` as a **structured object** with three separate fields:

```
compress(
  topic="Short label 3-5 words",
  content={
    startId: "m0001",      // ← string field
    endId: "m0042",        // ← string field
    summary: "..."         // ← string field
  }
)
```

## WRONG Usage (causes the error)

```
// ❌ NEVER pass content as a stringified JSON blob
compress(
  topic="...",
  content='{"startId": "m0001", "endId": "m0042", "summary": "..."}'
)
```

## Rules

1. `content.startId` — must be a non-empty message ID string (e.g. `"m0015"` or `"b1"`)
2. `content.endId` — must be a non-empty message ID string that appears AFTER startId
3. `content.summary` — must be a detailed technical summary string
4. ALL THREE fields are required — omitting any one causes validation failure
5. Use only IDs visible in the current context — never invent IDs

## ID Sources

- Raw messages: `mNNNN` format (injected as `<dcp-message-id>mNNNN</dcp-message-id>`)
- Compressed blocks: `bN` format (e.g. `b1`, `b2`)
- Only use IDs that are currently visible — never guess or fabricate them
