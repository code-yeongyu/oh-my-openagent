# opencode SDK (@opencode-ai/sdk) - reference only

A TypeScript/Bun way to drive opencode for QA. Prefer the tested CLI/curl scripts for portability; reach for the SDK when you want typed access from a Bun script.

> IMPORTANT: method signatures differ between SDK versions and between the published docs and the generated client. ALWAYS check the installed version's types (node_modules/@opencode-ai/sdk) before relying on a signature, and verify against `GET /doc` (the OpenAPI spec the SDK is generated from).

## Entry points and exports

Package `@opencode-ai/sdk` subpath exports:

- `.` (src/index.ts)
- `./client`
- `./server`
- `./v2` (src/v2/index.ts)
- `./v2/client`
- `./v2/server`
- `./v2/gen/client`

Root and v2 entries export `createOpencode()`, `createOpencodeClient(...)`, `createOpencodeServer(...)`.

`createOpencodeServer()` spawns `opencode serve ...` and waits for the startup line. `createOpencodeClient({ baseUrl })` wraps the generated client, rewrites directory/workspace headers, installs error interception.

## Two ways to connect

```ts
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk/v2"

// A) embedded server (spawns opencode serve)
const server = await createOpencodeServer()
const client = createOpencodeClient({ baseUrl: server.url })
// ... use client ...
server.close()

// B) connect to an already-running server
const client2 = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096" })
```

## Client namespaces

Top-level on OpencodeClient:

auth, app, global, event, config, experimental, tool, worktree, find, file, instance, path, vcs, command, lsp, formatter, mcp, project, pty, question, permission, provider, session, part, sync, v2, tui.

## Useful methods (shapes vary by version)

- `client.global.health()`, `client.global.event()`
- `client.app.log(...)`, `client.app.agents(...)`, `client.app.skills(...)`
- `client.config.get()`, `client.config.providers()`
- `client.event.subscribe()` - SSE on /event; iterate `for await (const event of events.stream) { event.type, event.properties }`
- `client.session` (legacy surface): list, create, status, get, update, delete, children, todo, diff, messages, message, deleteMessage, prompt, promptAsync, command, shell, fork, abort, init, share, unshare, summarize, revert, unrevert
- `client.v2.session` (newer read/stream surface): list, prompt, compact, wait, context, messages
- `client.part.delete(...)`, `client.part.update(...)`

## Minimal QA snippet

Arg shapes may differ by version. Treat this as a starting point, not a contract.

```ts
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk/v2"

const server = await createOpencodeServer()
const client = createOpencodeClient({ baseUrl: server.url })

try {
  const session = await client.session.create({ title: "QA session" })
  await client.session.promptAsync({
    sessionID: session.id,
    parts: [{ type: "text", text: "Say hello in one line." }],
  })

  const sessions = await client.session.list({ limit: 10 })
  console.log(sessions[0]?.title)

  const messages = await client.v2.session.messages({
    sessionID: session.id,
    limit: 20,
  })
  console.log(messages.items.length)
} finally {
  server.close()
}
```

## Key types

- Legacy Session: id, slug, projectID, directory, title, version, time.created/updated, optional workspaceID, path, parentID, summary, cost, tokens, share, agent, model, metadata, permission, revert.
- Message = UserMessage | AssistantMessage (role "user" | "assistant"; assistant adds time.completed?, modelID, providerID, agent, tokens, finish?, error?).
- Part union: TextPart, ReasoningPart, FilePart, ToolPart, StepStartPart, StepFinishPart, SnapshotPart, PatchPart, AgentPart, RetryPart, CompactionPart, SubtaskPart.

## How it is generated

`packages/sdk/js/script/build.ts` runs `bun dev generate > openapi.json` from the opencode repo, feeds it to `@hey-api/openapi-ts.createClient`, writes output to `packages/sdk/js/src/v2/gen`, patches an SSE generic, prettifies and typechecks. Regenerate with `./packages/sdk/js/script/build.ts`.

---

For version-stable QA, prefer the curl/CLI scripts in this skill; cross-check any SDK call against `GET /doc`.
