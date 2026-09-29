# omo-gateway - Chat-Surface Gateway

**Created:** 2026-09-29 (gateway plan todo 2 scaffold)

## OVERVIEW

The gateway routes Slack, Discord, Telegram, Notion and Feishu conversations into omo sessions with
identity, roles and conversation rules, on top of the session-gateway library (store, bindings,
deliveries, outbox). This package holds the surface adapters, the connector host, admission,
dispatch/lead/work items and the rules layer. It is a scaffold: `src/` carries only the module
contract until the adapter/connector todos land.

## INVARIANTS (binding on every todo that fills this package)

- **Never imported on the omo startup path.** With no `gateway` section in omo.json nothing here
  loads. The only sanctioned import site is a lazy `import()` inside
  `packages/omo-native/bin/lib/gateway.js`; `omo --help`, `--version`, daemon, doctor-without-
  gateway and every other command must stay gateway-free.
- **Nothing runs without configuration.** No listener, connector, lead or network unless a
  `gateway` section exists (IS-9: absent config = unchanged behavior and startup time).
- **One store, one identity table, one chat-thread<->session map** - the session-gateway library
  owns them; this package never re-implements or duplicates any of them.
- **Discord is bot-token only.** The agent-messenger `discord` (user-account) module is never
  imported; only `discordbot`.
- Config shape lives in `packages/omo-config-core/src/schema/gateway.ts` (strict, all-optional
  except `scopes[].id`; a surface account belongs to exactly one scope).

## agent-messenger dependency audit (2026-09-29, scaffold decision)

- **Published / stable name:** `agent-messenger` on npm, latest 2.38.1, first published
  2026-01-30, releases active through 2026-09-28. Local checkout: the OmOCat-used repo.
- **License: too weak to pin on.** The README declares "MIT", but package.json carries no
  `license` field, the repository ships no LICENSE file, and npm metadata for 2.38.1 reports no
  license. A README line alone is not license provenance for a dependency of a desktop-pinned
  release.
- **Install size:** unpacked ~17.9 MB with 22 runtime dependencies (including
  `@whiskeysockets/baileys`, `thrift`, `node-jose`, `classic-level`), most of them for platforms
  the gateway never touches; installation cost is paid per install even though only three
  submodules are imported.
- **Submodules the adapters will import:** `agent-messenger/slack` (~700 KB src),
  `agent-messenger/telegrambot` (~128 KB), `agent-messenger/discordbot` (~284 KB) - listener,
  client and credential-manager per platform. NEVER `agent-messenger/discord` (user-account
  module; the plan forbids user-account sends).
- **Decision:** NOT added as a dependency in this scaffold. Todo 6 (adapters) adds it, after the
  license is confirmed upstream (a package.json `license` field or a LICENSE file); until then
  the audit above is the record. If upstream cannot confirm, the adapters fall back to direct
  platform API clients.
- **Todo 6 outcome (2026-09-29):** upstream still ships no `license` field and no LICENSE file, so
  the Slack adapter (like the Discord and Telegram adapters) uses direct clients: Web API over
  `fetch`, RTM and Socket Mode over Bun's `WebSocket`. agent-messenger is NOT a dependency; only
  its credential store file format (`slack-credentials.json` -> `workspaces[<team id>]`) is read by
  `src/adapters/slack/connect.ts`.

## Slack adapter (`src/adapters/slack/`, plan todo 6)

- **Two profiles** (`surfaces[].token_kind`): `user` = a member session token (xoxc + `d` cookie),
  realtime over RTM (`rtm.connect`), typing as `user_typing` frames on that same RTM line;
  `bot` = a user-created Slack app (xoxb bot token + xapp app-level token), realtime over Socket
  Mode (`apps.connections.open`), streaming through the contract op `stream_draft` (capability
  `draft_stream`: chat.startStream / appendStream / stopStream, threads only, append-only, the
  final op replaces rewritten text with chat.update), typing through `assistant.threads.setStatus`
  (threads only). `buttons` is false on both until a RenderedOp carries buttons (execution
  amendment); `thread_archive` is false (Slack threads cannot be archived); `presence` is true only
  for the user profile (the RTM line keeps it active). `docs-matrix.test.ts` pins both rows of the
  platform matrix in docs/adapters.md to `SLACK_CAPABILITIES`.
- **One realtime line per account** (`realtime.ts`): listen and typing share it; typing without a
  listener opens it once and closes it after 60 s idle. Every wait is bounded (dial 30 s, hello
  30 s, pong 10 s, reconnect backoff 1 s .. 30 s). Never `rtm.connect` per message.
- **Dead credential** (`invalid_auth`, `token_revoked`, `token_expired`, `account_inactive`,
  `not_authed`, a workspace mismatch, Socket Mode `link_disabled`): `SlackAuthError`, an
  `AdapterFatal`. The `AuthLatch` refuses every later call with that same error without touching
  Slack, and the connector host stops the connector with one owner notice and restarts it only when
  the config or credential file changes.
- **Mentions**: `<@self>` is a mention; `@here`, `@channel`, `@everyone` are mentions of the channel
  (`kind: "mention"`, `broadcast: true`).
- **Uploads**: the share's message ts is read from `files.info`, retried on the adapter clock
  (`SHARE_LOOKUP`: 5 reads, 500 ms doubling); if the share never appears, `message_id` is the file
  id and one log line says so (`upload.ts`).
- **Connector**: `omo gateway connect --surface slack` uses `connect.ts` as the built-in factory;
  an `api_base` next to the token in the credential document points it at another Web API root.
- **Gateway marker**: posts carry message metadata `event_type: "omo_gateway"`. Measured live on
  2026-09-29 with a member session token: `chat.postMessage` answers ok but does NOT store the
  metadata, so the adapter turns the marker off after the first post (one log line) and the loop
  guard for user-token gateways is `agent_accounts`. App tokens keep the marker.
- **Links**: every post carries an explicit `rich_text` block (a user token leaves `<url|label>`
  literal in plain text); a bare URL stays a text element, labeling it is the `link_label` gate.
- **Posting pace**: a token bucket of one message write per second per channel.
- **QA**: `bun packages/omo-gateway/src/adapters/slack/qa.ts --fake --scenario happy|bare-url`;
  live: `--live --scenario happy --credentials-dir <0700 store> --team <id> --channel <QA channel>`
  (posts only to that channel and deletes what it posted).

### R9: RTM and classic-app deprecation (checked 2026-09-29)

- Slack paused the classic-app deprecation on 2025-12-08: classic apps keep working "for the
  foreseeable future", new classic apps cannot be created, migration is still recommended
  (https://docs.slack.dev/changelog/2025/12/08/classic-apps-deprecation-paused/). The earlier
  schedule (legacy custom bots discontinued 2025-03-31; classic apps first 2026-03-31, later
  2026-11-16) is https://docs.slack.dev/changelog/2024-09-legacy-custom-bots-classic-apps-deprecation.
- The RTM API itself was never announced as deprecated; `rtm.start` became `rtm.connect`
  (https://docs.slack.dev/changelog/2021-10-rtm-start-to-stop/). New Slack-app bot tokens cannot use
  RTM, which is why the app profile listens over Socket Mode. The user profile's RTM line runs on a
  member session token and was verified working on 2026-09-29; it depends on Slack keeping RTM for
  session tokens, so the app profile is the migration path if that ever ends.

## Slack huddle voice surface (`src/adapters/slack-huddle/`, plan todo 35)

A huddle has no public API, so this surface joins the way a person does: the Slack web client in an
isolated headless browser signed in as the workspace's own member account. It ships as a
`VoiceSurfaceAdapter` for the voice pipeline AND as a loopback service any agent can drive through
`skills/slack-huddle-voice/SKILL.md`.

- **No debugging port.** The browser is driven over its stdio protocol pipe (`--remote-debugging-pipe`),
  so no other process on the machine can attach to it or read its session over a socket.
- **Throwaway profile, always.** Every call gets a fresh `0700` directory that is deleted on every exit
  path. A watchdog process holds the owner's stdin and cleans up even after `kill -9`; it also notices
  being reparented, so a leaked pipe descriptor cannot strand a browser. Profiles orphaned by a power
  cut are swept on the next launch (`sweepStaleProfiles`).
- **The fake microphone is silence**, not the browser's built-in test tone: a call hears nothing until
  `speak` injects audio.
- **The media state is the authority.** Join drives the client's own controls (which are not ours and
  can change), but "the call is up" means the peer connection reached `connected`. Controls are waited
  for with an in-page MutationObserver, never polled from the host.
- **Attribution is `"roster"`, never `"exact"`.** The conferencing SFU mixes every participant into one
  track; who is talking comes from the signalling frames (`chime.ts`). One audible unmuted participant
  labels the frame; silence or crosstalk leaves it unattributed rather than guessed.
- **Consent by default.** `onHumanJoin: "stop_capture"` stops the tap the moment anyone else joins,
  until the caller has announced the bridge. Audio never touches disk.
- **One call per account** (~600 MB of browser); a second join is refused, not queued.
- **Local surface**: `/status`, `/join`, `/leave`, `/capture`, `/speak`, `/stats` and a `/stream`
  websocket (events as JSON, audio as binary frames), bound to `127.0.0.1` with a `0600` token file.
- **QA**: `bun packages/omo-gateway/src/adapters/slack-huddle/qa.ts --chat <QA channel> --agent-dir <dir>`
  against a running surface; synthetic tone only, QA channel only.
- **Known limits**: capture and playout run on the page main thread (an AudioWorklet is the next step);
  attribution beyond this account's own stream needs a second human in the call.

## LAYOUT

```
src/index.ts                 barrel: adapter contract, rich body, transcriber
src/adapter/contract.ts      SurfaceAdapter contract (published API)
src/adapter/rich.ts          gateway body markup -> RichBody, plainText
src/adapter/capability.ts    capability -> refusal mapping (checkCapability)
src/adapter/conformance.ts   `@oh-my-opencode/omo-gateway/conformance` entry: runAdapterConformance + re-exports
src/adapter/conformance/     the checks, fixtures types and bounded waits
src/adapter/conformance-bun.ts  thin bun:test wrapper for in-repo adapters
src/adapters/fake/           FakePlatform (reusable in-memory platform) + FakeAdapter
src/adapters/slack/          Slack adapter (user + app token profiles), testing/ fake Slack server, qa.ts
src/stt/                     voice transcription (gateway.stt; soniox), audio never on disk
scripts/build-conformance.ts standalone conformance build -> dist/conformance (installable outside the repo)
docs/adapters.md             adapter author guide: contract, capability model, platform matrix, conformance
```

The adapter contract is a public extension point (third-party adapters, e.g. Feishu/Lark, build on
it): read [docs/adapters.md](docs/adapters.md) before changing any type in `src/adapter/`. Core
modules (`src/adapter`, `src/rules`, `src/admission`, `src/dispatch`, `src/connector`) stay
platform-neutral; `src/adapter/platform-neutral.test.ts` fails on Slack wire vocabulary there.

## COMMANDS

```sh
bun test src/**/*.test.ts      # package tests (root: bun test packages/omo-gateway)
bunx tsgo --noEmit -p tsconfig.json
bun run build:conformance      # dist/conformance: self-contained conformance entry for third-party adapters
```

The CLI surface (`omo gateway status|connect|lead|rules|link|service`) lives in
`packages/omo-native/bin/lib/gateway.js`, not here.
