# Team chat workspace - agent rules (synthetic fixture)

A paraphrase of a real team rules file with every id, name and organization removed. The rules
importer tests map each bullet below to a rule record through slack-rules.map.json.

## Language and scope
- English only, always: the sender refuses text written in any other script.
- Team work only: never post the owner's personal matters or material from other organizations; take such requests to the owner in private.

## Work requests channel
- One request is one thread is one session; any work decided in any conversation also gets a thread in the work requests channel.
- Thread header format: the requester mention and a one-line summary, then a source link labeled "from #channel", a blank line, and the status line.
- Every status change appends a status reply in the thread, edits the header status line, and keeps exactly one status reaction on the header.
- Questions offer numbered options so people can answer with a number emoji or a reply.

## Decisions
- When a decision is needed, tag the owner with the options and a recommendation, and keep re-pinging until it is settled.

## Formatting
- Never post a bare URL: always give links a label; GitHub issue and pull request labels carry the number and the title.
- The requester is a real mention, never a bold name.
- Images must be readable on a phone: viewport-sized per-scene captures, never one tall full-page screenshot.
- Show the typing indicator only while actually writing a message.

## Other agents
- Bot messages never start work: messages from bots, from other gateways and from listed agent accounts are ignored.

## Channels and operations
- The agent work sharing channel is only for sharing the status of local sessions.
- The agent's own operations use its own browser profile and APIs, never the owner's browser.
