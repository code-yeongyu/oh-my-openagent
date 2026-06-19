---
name: teammode
description: Codex-only team orchestration with durable team state and coordinated thread cleanup
---

# Teammode

Use this skill when the user asks Codex to create, coordinate, inspect, archive,
or delete a team of Codex threads. This is a Codex-only workflow. It is inspired
by the lifecycle concerns in Yeachan-Heo/oh-my-codex team skill, but it does not
copy that runtime model or depend on an external terminal runner.

## Core Model

A team is the parent object. Threads and subagents are members of that team, not
the other way around. Store the team record under:

```text
.omo/teams/{session_id}/team.json
.omo/teams/{session_id}/notepad.md
.omo/teams/{session_id}/events.jsonl
```

`{session_id}` is the leader Codex session id when available. If the current
session id is not exposed, use a stable timestamp slug and record the fallback
in `events.jsonl`.

The `team.json` shape is:

```json
{
  "schemaVersion": 1,
  "sessionId": "{session_id}",
  "teamName": "Team Name",
  "activeTeam": true,
  "archived": false,
  "leader": {
    "threadId": "leader-thread-id",
    "role": "leader",
    "title": "[team name] {session name}"
  },
  "members": [
    {
      "id": "A",
      "threadId": "member-thread-id",
      "role": "release analyst",
      "status": "active",
      "title": "[team name] {session name}"
    }
  ]
}
```

Keep `notepad.md` for leader memory, peer digests, decisions, and cleanup notes.
Append every create, broadcast, status, archive, and delete action to
`events.jsonl`.

## Team Creation

1. Choose a short team name and a session name before creating members.
2. Every team-created thread title must use this exact shape:
   `[team name] {session name}`.
3. Write `team.json` before sending work to members.
4. Create durable member threads with `codex_app.create_thread` when available.
   Use `codex_app.set_thread_title` immediately after creation if the title did
   not land during creation.
5. For short in-turn helper lanes, `multi_agent_v1.spawn_agent` is acceptable,
   but durable teams should prefer Codex thread tools so the team remains visible
   as a set of archived or active threads.

Member prompts must be self-contained and English-only. Include:

- team name and leader thread id
- the member's explicit role and owned scope
- the exact deliverable and verification expectation
- the team state directory path
- instructions to send `WORKING: <role> - <phase>` during long work
- instructions to send a concise final report to the leader
- instructions that all member-to-member and member-to-leader communication is
  English-only

## Communication

The leader owns coordination. Members own their assigned lane and report risks
that affect other lanes.

Use `codex_app.send_message_to_thread` for leader-to-member messages and
broadcasts. Use `codex_app.read_thread` to inspect recent member status before
reassigning or summarizing. Broadcast peer digests when one member finds context
that changes another member's assumptions.

Cadence:

- Require frequent status updates for long tasks, usually every 30-60 seconds of
  active work or at each phase boundary.
- Members acknowledge handoffs with understood scope, affected files or topics,
  owner, and next action.
- The leader records status snapshots in `notepad.md` and `events.jsonl`.
- The leader waits for every required member final report before claiming the
  team is complete.

For bounded in-turn helper work, use:

```json
{
  "tool": "multi_agent_v1.spawn_agent",
  "arguments": {
    "fork_context": false,
    "message": "TASK: act as a focused teammate. DELIVERABLE: ... SCOPE: ... VERIFY: ... Communicate in English only."
  }
}
```

Wait with `multi_agent_v1.wait_agent` and close finished helper agents with
`multi_agent_v1.close_agent`. Record helper ids in `team.json` only when they
materially contributed to the team result.

For helper agents that may take longer than one wait cycle, require both
progress markers: `WORKING: <task> - <current phase>` before long work and
`BLOCKED: <reason>` only when the helper cannot progress. A
`multi_agent_v1.wait_agent` timeout only means no new mailbox update arrived.
Treat a running helper as alive. Fallback only when the helper is completed
without the deliverable, ack-only after follow-up, explicitly `BLOCKED:`, or no
longer running.

## Archive

Archiving a team closes or archives every member before the team is marked
archived.

1. Send a final archive notice to every active member thread with
   `codex_app.send_message_to_thread`.
2. Inspect each member with `codex_app.read_thread` and copy useful final notes
   into `notepad.md`.
3. Archive every member thread with `codex_app.set_thread_archived`.
4. Close any helper subagents with `multi_agent_v1.close_agent`.
5. Set `activeTeam` to `false`, set `archived` to `true`, and append the archive
   receipt to `events.jsonl`.

If a thread archive tool is unavailable, record the failed archive attempt and
the member thread ids in `events.jsonl` and surface that limitation to the user.
Do not pretend the member was archived.

## Delete

Delete is stronger than archive.

1. Archive first when `archived` is not already `true`.
2. Confirm there are no active member threads left unhandled.
3. Remove `.omo/teams/{session_id}` only after the archive receipts and useful
   notes have been preserved or explicitly deemed disposable by the user.
4. Report which team directory was removed and which threads were archived.

Never delete team state while member threads are still active unless the user
explicitly requested an abort and you recorded the abort in `events.jsonl`.

## Stop Rules

- Stop and ask before deleting a non-archived team if any member is still active.
- Stop if the user asks for private or non-English member communication; team
  member communication remains English-only.
- Stop if thread tooling is unavailable and the requested operation depends on
  creating, reading, sending to, or archiving actual Codex threads.
