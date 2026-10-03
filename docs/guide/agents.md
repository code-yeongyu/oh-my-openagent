# Agents

When OmO takes on a bigger job, the main agent in your thread can hand parts of it to other agents. These helpers work in the background, each on one piece, and report back to the main agent when they finish. You keep talking to the main agent the whole time.

## Get OmO to delegate

Put `ulw` in your message to let OmO plan the job and hand out work where that helps:

```text
ulw add dark mode to the settings page
```

You can also just ask in plain words, like "split this up and research each option in parallel". OmO decides how many agents a job needs; small jobs often need none.

## Kinds of delegated work

- **Task**: one agent does one piece of work, such as searching the code or writing a single change.
- **Team**: a few agents work on related parts and can message each other while they work.
- **Workflow**: a large job split into many tasks that run in waves. See [Workflows](workflows.md).

## The Agents panel in OmO Desktop

Every agent your thread starts shows up in the Agents panel with:

- its state: Working, Idle (it finished but can pick up more work), Done, Failed or Stopped
- what it is doing right now
- how long it has been running and how many tokens it has used

From the panel you can open an agent to read its full conversation, send it a message, or cancel it. Cancelling stops that agent only; the main agent is told and carries on.

## Related

- [Workflows](workflows.md): many agents running one large job
- [Keywords](keywords.md): the words that switch these modes on
