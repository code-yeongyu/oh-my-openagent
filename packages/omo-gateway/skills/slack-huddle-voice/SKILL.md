---
name: slack-huddle-voice
description: "Join a Slack huddle as the workspace's own member account, listen to it as PCM, speak into it, and read join/leave/speaking events over a loopback API and websocket. Use when an agent must take part in a huddle by voice, bridge a huddle into a session, or prove the huddle voice path end to end. Triggers: slack huddle, huddle voice, join a huddle, speak in a huddle, huddle audio, voice bridge."
---

# Slack huddle voice

A huddle has no public API: no Slack method joins one or hands you its audio. This surface joins the
way a person does, by driving the Slack web client in an isolated headless browser signed in as the
workspace's own member account, and exposes that call as a small local service.

What you get: **join / leave / status** over HTTP, and a websocket carrying **inbound audio**,
**outbound audio**, and **call events** (joined, left, speaking start/stop, ended, error).

## Before you touch it — the limits are the feature

1. **Announce the call, always.** Receiving huddle audio is recording people. The pipeline announces
   the bridge in the huddle thread before it listens. The driver defaults to
   `onHumanJoin: "stop_capture"`: the moment anyone else joins, the tap stops and an event says why.
   Only a caller that has announced itself sets `"continue"`.
2. **Explicit joins only.** A huddle is joined on a command from an allowed user. Never auto-join.
3. **One call per account.** A call costs roughly 600 MB of browser. A second concurrent join is
   refused with a clear message, never queued.
4. **QA goes in the QA channel and nowhere else**, with synthetic audio only.
5. **The session is a password.** It is read from the connector's credential store, handed to the
   browser once, and never logged, printed, or written into the profile by us. Do not echo it, do not
   screenshot storage panes, do not paste it into an issue.
6. **No audio ever reaches disk.** Frames live in memory and are gone. Nothing here writes a WAV.
7. **This is a real member seat**, not a Slack-sanctioned bot surface. Slack can change the client at
   any time; treat a broken join as expected maintenance, not a crisis.

## Run it

```bash
# start the surface (foreground; it writes its port next to the token)
bun packages/omo-gateway/src/adapters/slack-huddle/cli.ts serve \
  --account <workspace id> --credentials-dir <0700 credential store>

# what it is doing right now
bun packages/omo-gateway/src/adapters/slack-huddle/cli.ts status

# join the QA channel's huddle, say a 3 second tone, then leave
bun packages/omo-gateway/src/adapters/slack-huddle/cli.ts join --chat <channel id>
bun packages/omo-gateway/src/adapters/slack-huddle/cli.ts say-tone --seconds 3
bun packages/omo-gateway/src/adapters/slack-huddle/cli.ts leave
```

The surface binds `127.0.0.1` only and every request carries the token from
`<agent dir>/gateway/huddle/token` (mode `0600`, created on first run). A request without it is
refused with 401 before it reaches the call.

## Talk to it from code

```ts
const token = (await Bun.file(`${agentDir}/gateway/huddle/token`).text()).trim()
const port = (await Bun.file(`${agentDir}/gateway/huddle/port`).text()).trim()
const socket = new WebSocket(`ws://127.0.0.1:${port}/stream`, [`omo-huddle.${token}`])
socket.binaryType = "arraybuffer"

socket.addEventListener("message", (event) => {
  if (typeof event.data === "string") {
    const call = JSON.parse(event.data) // joined | left | speaking | ended | error
    return
  }
  const frame = decodeAudioFrame(new Uint8Array(event.data)) // 48 kHz PCM16 + speaker
})

// speak: one binary frame, 16/24/48 kHz PCM16 mono
socket.send(encodeAudioFrame({ direction: "outbound", sample_rate: 24000, at_ms: Date.now(), speaker: null, pcm16 }))
```

`speak` resolves when the audio has actually played out, and the page reports when its queue has room
again, so a text-to-speech source faster than real time is paced instead of buffered without bound.

## What the audio actually is

The huddle's media plane is a conferencing SFU that **mixes every remote participant into one audio
track**. So:

- Inbound audio is **one mixed 48 kHz stream**, not one stream per person.
- Speaker identity comes from the signalling frames, not the audio: when exactly one unmuted
  participant is audible, the frame is labelled with them and `attribution` is `"roster"`. During
  silence or crosstalk the frame is `"unattributed"` — it is never guessed.
- `voiceCapabilities().speaker_ids` is therefore `"roster"`, never `"exact"`.

## Known limits, honestly

- The join path drives the client's own buttons, so a Slack redesign can break it. The authority for
  "the call is up" is the peer connection reaching `connected`, not a button click.
- The audio tap and playout run on the page's main thread (a `ScriptProcessorNode`). Under heavy page
  load that is the first thing to glitch; an `AudioWorklet` is the known next step.
- Speaker attribution is proven for this account's own stream. Mapping every attendee to a Slack user
  needs a second human in the call.
- One huddle per browser, roughly 600 MB resident.

## When it breaks

`status` tells you the state. A `fatal` error event means the call is gone and the pipeline should
tear down rather than rejoin in a loop. If the browser dies, its profile is removed by a watchdog that
survives even a `kill -9` of the surface; profiles orphaned by a power cut are swept on the next
launch.
