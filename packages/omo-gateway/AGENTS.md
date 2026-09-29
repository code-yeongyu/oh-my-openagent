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
