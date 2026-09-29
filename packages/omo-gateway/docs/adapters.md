# Writing a gateway surface adapter

A surface adapter connects one chat platform account to the omo gateway. It turns platform events
into `InboundEvent`s and turns `RenderedOp`s into platform calls. Everything else (who may talk,
where a message goes, rules, status presentation, splitting long text, downgrades) is gateway core
and stays out of the adapter.

You can write an adapter without reading core code: this page, the types in
`@oh-my-opencode/omo-gateway/conformance`, and the conformance suite are the whole contract.

```ts
import {
  runAdapterConformance,
  type SurfaceAdapter,
  type Capabilities,
  type InboundEvent,
  type RenderedOp,
  type SendResult,
} from "@oh-my-opencode/omo-gateway/conformance"
```

## The contract in one screen

```ts
type Platform = "slack" | "discord" | "telegram" | "notion" | "feishu"
type SurfaceKey = { platform: Platform; account_id: string; chat_id: string; thread_id: string | null }

interface SurfaceAdapter {
  readonly platform: Platform
  capabilities(): Capabilities
  listen(onEvent: (e: InboundEvent) => void, signal: AbortSignal, ready: () => void): Promise<void>
  catchUp(since: string, threads: readonly SurfaceKey[]): AsyncIterable<InboundEvent>
  send(op: RenderedOp): Promise<SendResult>
}
```

- **`SurfaceKey`** says where a message lives. `account_id` is the gateway's own account (workspace,
  bot or app id), `chat_id` is a DM, channel, group or page, `thread_id` is the platform thread
  inside that chat or `null` for the chat itself. All ids are opaque strings: core never parses
  them, compares them only for equality, and never sorts by them.
- **`listen`** delivers realtime events until `signal` aborts, then resolves. Call `ready()` once the
  connection is live (socket open, first poll answered). Core runs `catchUp` right after `ready()`,
  which closes the gap between "connecting" and "listening". An adapter that never calls `ready()`
  fails conformance.
- **`catchUp(since, threads)`** yields every event after the ISO time `since` in the chats the
  account listens to, plus replies in `threads` (the bound threads core cares about). Core calls it
  on (re)connect and on an interval as a backstop. It may repeat events `listen` already delivered;
  that is fine as long as the `event_id` is the same (see Dedupe).
- **`send(op)`** performs one op and returns `{ message_id, permalink, created }`.
  `message_id` is the platform id of the message posted, edited or opened (an empty string for ops
  that post nothing: typing, reactions, archive, create_chat, a non-final `stream_draft`). `created` is the new thread's key
  for `open_thread` and the new chat's key for `create_chat`, and `null` otherwise. When an op
  needs a capability you report as `false`, throw `AdapterRefusal` (see Refusals). Never drop an op
  silently and never return a fake success.

### Inbound events

| Field | Meaning |
| --- | --- |
| `event_id` | Platform-unique, **stable** id: the same platform message must get the same `event_id` from `listen` and from every `catchUp`. Core dedupes on it. |
| `key` | Where it happened. A reply inside a thread carries that thread's `thread_id`. |
| `author` | `platform_user_id`, `display`, `is_bot`. Set `is_bot` for every bot or app author; core drops them before admission. |
| `kind` | `dm`, `mention`, `thread_reply`, `channel`, `reaction`, or `edit` (below). Report what the platform says; the connector's `listen` filter decides what to act on. |
| `broadcast` | Optional, `true` only on a `mention` that reached the gateway through a whole-chat mention (everyone in the chat was addressed, for example Slack `@here`, `@channel`, `@everyone`) and not by the gateway account's own name. Absent otherwise. |
| `reaction` | `{ name, on_message_id }` exactly when `kind` is `reaction`, else `null`. `name` is a gateway reaction name or a unicode emoji. |
| `edited` | `{ object_id, field }` exactly when `kind` is `edit`, else `null`. |
| `gateway_marker` | `true` when the post carries another omo gateway's marker (loop guard). |
| `text` / `transcript` | Message text. For an audio attachment, run the shared transcriber (below) and fill both with `voiceFields`. |
| `attachments` | `{ name, url, mime, bytes }` per file. |
| `reply_to` | The message this one quotes or replies to, when the platform says. |
| `at` / `permalink` | ISO-8601 time and a link to the message. |

`kind: "edit"` means a human changed an object the gateway tracks: an edited message, or a changed
field on a tracked record such as a ticket (`object_id` = the record, `field` = the property name,
`text` = the new value rendered as text). The Notion connector (work board) is the first producer.

### Voice messages

Adapters never talk to a speech-to-text provider directly. Use the shared transcriber, which reads
`gateway.stt` from the user config, keeps audio in memory (bytes are never written to disk), and
never logs the credential:

```ts
import { createTranscriber, isAudioAttachment, voiceFields } from "@oh-my-opencode/omo-gateway"

const transcribe = createTranscriber({ stt: gatewayConfig.stt })
const result = await transcribe(audioBytes, "voice.oga") // { text } | { unavailable }
const { text, transcript } = voiceFields(caption, result)
```

With no `gateway.stt`, or when the provider fails, `text` becomes `(voice message, no transcript)`
(after any caption) and `transcript` is `null`. A failed transcription never looks like an empty
successful message.

### Message bodies

Core hands adapters a platform-neutral `RichBody`, an array of nodes:

```ts
| { t: "text"; text: string; bold?: true }
| { t: "link"; url: string; label: string; bold?: true }
| { t: "mention"; platform_user_id: string; display?: string }
| { t: "channel"; chat_id: string; display?: string }
```

Render each node natively (Slack rich text elements, Discord markdown, Telegram HTML entities,
Feishu post/card elements). `plainText(body)` gives the notification fallback: labels, `@display`
and `#display` with no markup. Core builds bodies with `parseRich`, which reads the gateway markup
`*bold*`, `<url|label>`, `<@user|display>` and `<#chat|display>`. Bold may wrap links, a bare URL
stays text, and markup that does not fit a token stays literal.

### Reactions

Core uses gateway reaction names (`GATEWAY_REACTIONS`: `seen`, `working`, `done`, `failed`,
`waiting`, `question`, `number_1` .. `number_9`) or a literal unicode emoji. Map each name to your
platform's reaction. `GATEWAY_REACTION_EMOJI` is the default unicode for each name. Inbound
reactions should be reported under the same names when they map back. A name your platform has no
reaction for is refused with `AdapterRefusal` on `reactions`, never swapped for another emoji.

**Numbered answers on Telegram arrive as reply text.** Telegram bots may react only from a fixed
emoji set with no keycap digits, so the Telegram adapter refuses `number_1` .. `number_9`. A
question's options are still posted as numbered lines (`1. Ship now`, `2. Wait for review`), and
people answer by replying with the number: the answer arrives as an `InboundEvent` whose `text`
is `2` and whose `reply_to` is the question message. So core must read numbered answers from
reply text; a number reaction is an extra answer form only where the adapter accepts it.

## Capabilities

`capabilities()` is read once per connection. Report only what the account can really do. Core
downgrades every `false` flag, and the conformance suite checks that ops needing a `false` flag are
refused.

| Flag | Meaning | What core does when it is `false` |
| --- | --- | --- |
| `edit` | Edit a message the gateway posted. | Progress and status updates are appended as new posts instead of edited in place. `edit` ops are refused. |
| `reactions` | Add and remove reactions on messages. | No status reaction. The header status line carries the status alone. `react` / `unreact` are refused. |
| `typing` | Show a typing indicator. | No typing indicator. `typing` is refused. |
| `threads` | Platform threads inside a chat (`thread_id` non-null). | Work items open as top-level posts with a header, and follow-ups go to the chat. `open_thread` and any op whose key has a `thread_id` are refused. |
| `thread_archive` | Archive and reopen a thread. | A closed work item is marked in its status line only. `archive_thread` / `reopen_thread` are refused. |
| `buttons` | Interactive buttons on a message. | Choices are posted as numbered options and answered by reply or number reaction. |
| `streaming` | The platform account can show one message growing as text arrives, in any platform way. | Informational. Core drives live text only through `stream_draft` (next row). |
| `draft_stream` | The adapter carries `stream_draft` ops: a live draft preview, then one final message. | Post, then edit as text grows (or a single final post when `edit` is also false). `stream_draft` is refused. |
| `uploads` | Upload files into a chat or thread. | The file is announced by title and path in text. `upload` is refused. |
| `rich_links` | Labeled links (text differs from URL). | Links render as `label (url)` in plain text. |
| `presence` | Show the gateway account as online or present. | No presence indicator; nothing else changes. |
| `chat_create` | Create chats (channel, topic, group) through `create_chat`. | `create_chat` is refused with the reason `create_chat needs capability chat_create, which is false on <platform>`, and the lead reports that it cannot create chats on that surface. |
| `max_text` | Longest text one post or edit may carry, counted on `plainText(body)`. | Core splits longer text at paragraph ends before sending. A post over `max_text` that reaches the adapter is refused. |

### stream_draft

```ts
{ op: "stream_draft"; key: SurfaceKey; draft_id: string; text: string; final: boolean }
```

With `final: false`, show `text` as the live draft `draft_id` at `key`. The draft replaces the
previous one with the same id, posts nothing, and `send` returns `message_id: ""`. With
`final: true`, post the finished message, which replaces the draft, and return its `message_id`.
Core sends the drafts of one reply in order under one `draft_id`, then exactly one final op.
`text` is plain text and counts against `max_text`. The Telegram adapter maps drafts to
`sendMessageDraft` and the final op to `sendMessage`. The Slack app-token profile maps the first
draft to `chat.startStream`, each later draft to `chat.appendStream` with the text added since the
previous one, and the final op to `chat.stopStream`. Slack drafts are append-only: a draft that
rewrites earlier text is not shown, and the final op replaces the message text with `chat.update`.
Slack streams only inside a thread, so a top-level `stream_draft` is refused on `draft_stream`
(core replies in threads there). An adapter whose platform streams some other way reports
`draft_stream: false` until it maps that way onto this op.

### create_chat

```ts
{ op: "create_chat"; key: { platform, account_id }; name: string; kind: "channel" | "topic" | "group"; members?: readonly string[] }
```

Create the chat, add `members` (platform user ids) where the platform allows, and return
`created: { platform, account_id, chat_id: <new id>, thread_id: null }`. The self-structuring lead
uses it to organize its own workspace. `kind` is a hint; map it to the nearest platform concept
(a Telegram forum topic, a Discord channel, a Feishu group chat).

### Refusals

```ts
import { AdapterRefusal, checkCapability } from "@oh-my-opencode/omo-gateway/conformance"

async send(op) {
  const refusal = checkCapability(this.platform, this.capabilities(), op)
  if (refusal) throw refusal
  // ... perform the op
}
```

`checkCapability` covers every flag and `max_text`. Throw it as-is, or build your own
`new AdapterRefusal(op.op, "<capability>", "<reason>")` when the platform refuses at runtime (for
example a Slack user token refusing buttons).

### Fatal errors

```ts
import { AdapterFatal } from "@oh-my-opencode/omo-gateway/conformance"

throw new AdapterFatal("slack", "invalid_auth", "Slack rejected the credential (invalid_auth on auth.test)")
```

Throw `AdapterFatal` (or a subclass) from `listen`, `catchUp` or `send` when the platform refuses
the account itself: a revoked, expired or invalid credential, or another client that owns the
account (a second Telegram poller). Retrying cannot help, so the connector host does not restart a
fatal `listen` with backoff. It stops that connector, writes exactly one notice for the scope owner,
and starts the connector again only when the gateway config or the credential file changes. Every
other error from `listen` is treated as transient and restarted with backoff. `reason` is the
platform's own code; never put a secret in it or in the message.

| Adapter | Raises `AdapterFatal` on |
| --- | --- |
| Slack | `invalid_auth`, `token_revoked`, `token_expired`, `account_inactive`, `not_authed`, a workspace mismatch, Socket Mode `link_disabled` |
| Discord | gateway close codes 4004 (authentication failed), 4010 - 4014 (shard, API version or intents refused) |
| Telegram | HTTP 401 (token rejected), 409 on `getUpdates` (another poller or a webhook owns the bot) |

### Platform matrix

Each adapter's `capabilities()` is authoritative and its conformance run proves it. This table
mirrors what the in-repo adapters report, and a test per adapter (`docs-matrix.test.ts`) parses it
and compares every cell with that adapter's `Capabilities` object: a cell reads `yes` or `no`
first (anything after is a note), and `max_text` is the number. `buttons` is `no` everywhere because no `RenderedOp`
carries buttons yet; choices go out as numbered options.

| Platform (account) | edit | reactions | typing | threads | thread_archive | buttons | streaming | draft_stream | uploads | rich_links | presence | chat_create | max_text |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Slack (member user token) | yes | yes | yes | yes | no | no | no | no | yes | yes | yes | yes | 40000 |
| Slack (app bot token) | yes | yes | yes (threads only: `assistant.threads.setStatus`) | yes | no | no | yes | yes (`chat.startStream`, threads only) | yes | yes | no | yes | 40000 |
| Discord (bot, with `guild_id`) | yes | yes | yes | yes | yes | no | no | no | yes | yes | yes | yes | 2000 |
| Discord (bot, without `guild_id`) | yes | yes | yes | yes | yes | no | no | no | yes | yes | yes | no | 2000 |
| Telegram (bot) | yes | yes (no `number_1` .. `number_9`) | yes | yes (forum topics) | yes | no | yes | yes (`sendMessageDraft`) | yes | yes | no | no (a topic is a thread: `open_thread`) | 4096 |
| Fake (`FakeAdapter` defaults) | yes | yes | yes | yes | yes | yes | yes | no | yes | yes | yes | yes | 4000 |

Notion and Feishu / Lark adapters are planned. Their rows are added with the adapters.

## Dedupe

The connector records every `event_id` it has handled and drops repeats. That works only if an
adapter gives one platform message the same `event_id` everywhere: live from `listen`, replayed by
`catchUp` after a restart, and replayed again on the next interval. Derive it from the platform's
own message or event id (for example `<chat_id>:<message id>`), never from a counter or a receive
time.

## Conformance

Every adapter, in this repo or outside it, runs the same suite. It is framework-agnostic: it returns
a report and never touches a test runner.

| Check | What it proves |
| --- | --- |
| `capabilities_shape` | Every flag is a boolean, `max_text` is a positive integer, `platform` matches the fixtures. |
| `event_id_unique` | Three human posts arrive through `listen` (after `ready()`) with three distinct, non-empty `event_id`s, the right key, `is_bot` false, an ISO `at`, and `reaction`/`edited` set exactly for their kinds. `listen` resolves on abort. |
| `dedupe_on_replay` | A freshly built adapter (a restart) replays those posts through `catchUp`, twice, with the same `event_id`s `listen` gave. |
| `edit_own_message` | Post then edit changes the same message in place; refused when `edit` is false. |
| `reaction_swap` | `working` -> `done` leaves exactly one reaction; refused when `reactions` is false. |
| `upload_ordering` | Uploaded files appear in the order sent; refused when `uploads` is false. |
| `thread_reply_placement` | `open_thread` returns a thread key in the same chat, a post to it lands in the thread and not at top level, and a human reply there arrives with that `thread_id`. Refused when `threads` is false. |
| `create_chat` | When claimed: the new chat has an id and accepts a post. |
| `stream_draft_honest` | `draft_stream` false: `stream_draft` is refused. True: three drafts post nothing and appear on the platform in order under one `draft_id`, then `final: true` posts one message with the final text. |
| `capability_refusals` | Every op needing a `false` flag, and a post over `max_text`, throws `AdapterRefusal` naming the missing capability. |

The suite drives the platform through **fixtures** you provide. They act on the platform directly,
normally a local fake server of your platform's API, never through the adapter:

```ts
type ConformanceFixtures = {
  chat: SurfaceKey // a chat the adapter may post in and humans can post in (thread_id null)
  humanPost(input: { key: SurfaceKey; text: string }): Promise<void>
  readMessage(key: SurfaceKey, message_id: string): Promise<{ text: string; reactions: readonly string[] } | null>
  readUploads(key: SurfaceKey): Promise<readonly string[]>
  readDrafts?(key: SurfaceKey, draft_id: string): Promise<readonly string[]> // draft texts shown, in order; required when draft_stream is true
  streamKey?(): Promise<SurfaceKey> // a fresh human thread for stream_draft_honest, for platforms that stream only in threads; default chat
  files?: readonly { path: string; title: string }[] // two or more, for upload_ordering
  timeoutMs?: number // bound on every wait; default 5000
}
```

`readMessage` returns `null` unless the message lives exactly at `key` (same chat and `thread_id`).
`text` is the plain rendering, and `reactions` are the gateway reaction names the gateway account
has on the message. `FakePlatform` is an in-memory model of a chat platform (chats, threads,
messages, reactions, uploads, a human-side inbound stream) with a ready-made `fixtures()`. You can
back a local fake HTTP or WebSocket server with it instead of writing that state yourself.

### Installing the conformance entry outside this repository

The source package cannot be installed by path from another project: it depends on workspace
packages (`@oh-my-opencode/memory-core: workspace:*` for the rules store) that only resolve inside
this monorepo. Install the standalone build instead. `build:conformance` bundles the conformance
entry (contract, rich body, capability refusals, the checks, `FakePlatform` and `FakeAdapter`)
into one self-contained ESM file with its type declarations, under a `package.json` named
`@oh-my-opencode/omo-gateway` that exports only `./conformance` and declares no dependencies:

```sh
# in an omo checkout
bun run --cwd packages/omo-gateway build:conformance   # -> packages/omo-gateway/dist/conformance

# in your adapter package
bun add @oh-my-opencode/omo-gateway@file:/path/to/omo/packages/omo-gateway/dist/conformance
```

The build fails if any import that needs an installed package survives bundling, and
`src/adapter/conformance-dist.test.ts` runs the suite from the built file. The bundle targets Node
ESM and runs under Bun or Node (the worked example below is checked with both). For TypeScript, use `"moduleResolution": "bundler"` (Bun's
default): the declarations use extensionless relative imports. Inside this repository, import
`src/adapter/conformance.ts` or the package's `./conformance` export (the source entry) directly.

### Worked example: an adapter outside this repository

A scratch package that depends only on the standalone build above and imports only
`@oh-my-opencode/omo-gateway/conformance`:

```ts
// my-adapter/conformance.ts - run with `bun conformance.ts`
import {
  FakePlatform,
  checkCapability,
  formatConformanceReport,
  runAdapterConformance,
  type Capabilities,
  type InboundEvent,
  type RenderedOp,
  type SendResult,
  type SurfaceAdapter,
  type SurfaceKey,
} from "@oh-my-opencode/omo-gateway/conformance"

// The platform the adapter talks to. A real adapter points its HTTP client at a local fake server;
// here the platform is the shared in-memory model.
const platform = new FakePlatform({ platform: "feishu", account_id: "T000TEST", chat_id: "C000TEST" })

class MyAdapter implements SurfaceAdapter {
  readonly platform = "feishu" as const
  capabilities(): Capabilities {
    return { edit: true, reactions: true, typing: false, threads: true, thread_archive: false, buttons: false,
      streaming: false, draft_stream: false, uploads: true, rich_links: true, presence: false, chat_create: true, max_text: 4000 }
  }
  async listen(onEvent: (e: InboundEvent) => void, signal: AbortSignal, ready: () => void) {
    const stop = platform.subscribe(onEvent)
    ready()
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
    stop()
  }
  async *catchUp(since: string, threads: readonly SurfaceKey[]) {
    const watched = new Set(threads.map((key) => `${key.chat_id}/${key.thread_id}`))
    for (const event of platform.inboundSince(since))
      if (event.key.thread_id === null || watched.has(`${event.key.chat_id}/${event.key.thread_id}`)) yield event
  }
  async send(op: RenderedOp): Promise<SendResult> {
    const refusal = checkCapability(this.platform, this.capabilities(), op)
    if (refusal) throw refusal
    const result = (message_id: string, created: SurfaceKey | null = null) => ({ message_id, permalink: platform.permalink(message_id), created })
    switch (op.op) {
      case "post": return result(platform.post(op.key, op.body).message_id)
      case "edit": return result(platform.edit(op.message_id, op.body).message_id)
      case "react": case "unreact": platform.react(op.message_id, op.name, op.op === "react"); return result("")
      case "upload": return result(platform.upload(op.key, op.files, op.comment).message_id)
      case "open_thread": { const opened = platform.openThread(op.key, op.root); return result(opened.root.message_id, opened.thread) }
      case "create_chat": return result("", platform.createChat(op.name, op.kind))
      default: throw new Error(`unreachable after checkCapability: ${op.op}`)
    }
  }
}

const report = await runAdapterConformance(() => new MyAdapter(), platform.fixtures())
console.log(formatConformanceReport(report))
process.exit(report.ok ? 0 : 1)
```

In this repository, adapters use the thin `bun test` wrapper instead:

```ts
import { testAdapterConformance } from "../../adapter/conformance-bun"
testAdapterConformance("slack adapter", () => new SlackAdapter(fakeServerConfig), () => fakeServer.fixtures())
```
