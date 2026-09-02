# Plan: Fix issue #6724 - Native /mcp auth overwrites the OAuth URL without opening a browser

Worktree: ../oom-wt-6724 (branch fix/6724-native-mcp-auth-url, base origin/dev @ 8c57e463e)
Evidence dir: .omo/evidence/20260826-issue6724-native-mcp-auth-url/
QA sandbox: /tmp/opencode/issue-6724/

## Issue summary

`/mcp auth <server>` in omo native flashes the OAuth authorization URL as a transient TUI
notification, immediately overwrites it with "Opening browser to authorize ...", and never
invokes the OS browser. The interactive flow then waits on its loopback callback while the
user has no usable URL. Expected: open the system browser to the authorization URL, or keep
the complete URL visible in persistent output.

## Traced flow (this repo)

```
CLI `mcp oauth login <name>` (packages/omo-opencode/src/cli/mcp-oauth/login.ts)
  -> McpOAuthProvider.login() (packages/mcp-client-core/src/mcp-oauth/provider.ts)
       -> discoverOAuthServerMetadata() -> getOrRegisterClient() (DCR)
       -> redirectToAuthorization(metadata)
            -> findAvailablePort() (callback-server.ts)
            -> runAuthorizationCodeRedirect() (oauth-authorization-flow.ts)
                 [URL BUILT]      buildAuthorizationUrl()
                 [SERVER START]   inline startCallbackServer(port)  <- listen is async, readiness NEVER awaited
                 [BROWSER OPEN]   openBrowser(url)                  <- fire-and-forget spawn, ALL errors swallowed
                 [VALIDATION]     await callback; state equality check
                 [STORED]         provider.saveCodeVerifier(verifier); later saveTokens()
       -> token exchange (code + verifier + redirect_uri) -> saveTokens()
```

Shim chain: packages/omo-opencode/src/features/mcp-oauth/* re-exports the core module;
packages/omo-opencode/src/cli/mcp-oauth/login.ts imports the provider directly.
The senpi engine's builtin `commands-auth-dispatch.js` maps `openBrowser` to a transient
notify, which is exactly the host-side symptom of the seam missing here: the shared flow
gives hosts no way to observe, inject, or persist the browser-open step.

## Root cause (in this repo's code)

`runAuthorizationCodeRedirect()` in packages/mcp-client-core/src/mcp-oauth/oauth-authorization-flow.ts:

1. Opens the browser BEFORE the loopback callback server is listening/accepting
   (`server.listen()` is async inside the promise executor; nothing awaits readiness).
   A fast client can hit a refused connection and fail authorization.
2. Swallows every browser-launch failure (`child.on("error", () => {})` plus an empty
   catch). When no browser can be opened (headless host, missing xdg-open, or a native TUI
   dispatch that only notifies), the flow silently waits out its 5-minute callback timeout
   and the user is left with no usable URL - the reported failure mode.
3. Exposes no injectable opener seam and does not return the authorization URL, so callers
   cannot display or persist the exact URL that was (or should have been) opened. The URL
   that opens and the state stored for callback validation can diverge from what the user
   sees.

## Fix design (minimal, root-cause)

File: packages/mcp-client-core/src/mcp-oauth/oauth-authorization-flow.ts

- Export `OAuthBrowserOpener` type: `(authorizationUrl: string) => void | Promise<void>`.
- Add optional `openBrowser?: OAuthBrowserOpener` to `runAuthorizationCodeRedirect` options;
  default remains the existing platform opener (darwin open / win32 explorer / linux xdg-open).
- Restructure the inline callback server so the function resolves only when the listener is
  actually accepting connections (await `listening` event), returning a small handle
  `{ waitForCallback(), close() }`. Keep `/callback` path-permissive behavior and the
  5-minute timeout semantics unchanged (the robust `/oauth/callback`-only callback-server.ts
  stays untouched; switching to it would change the registered redirect URI path).
- Ordering becomes: build URL -> start+await ready callback server -> hand EXACTLY that URL
  string to the opener -> await callback -> validate state -> close server.
- Propagate opener failures: close the server and throw an error whose message contains the
  full authorization URL ("Open the URL manually: <url>") instead of silently waiting.
- Default platform opener: reject on spawn error (ENOENT etc.) instead of swallowing it;
  still detached + windowsHide + unref on successful dispatch (preserves c6b178dc7).

File: packages/mcp-client-core/src/mcp-oauth/provider.ts

- `redirectToAuthorization()` now returns `{ code, authorizationUrl }` (additive) so callers
  can persist/display the same URL that was handed to the browser. Remove the now-unused
  `startCallbackServer` import. No behavior change to login()/refresh() beyond surfacing.

## TDD

RED (new file packages/mcp-client-core/src/mcp-oauth/oauth-authorization-flow.test.ts,
given/when/then, bun:test):

1. #given injected opener recording its argument #when redirect flow runs against a real
   loopback callback POST of code+state #then opener called exactly once, its argument is
   byte-for-byte the returned authorizationUrl, state param matches, code+verifier returned.
2. #given opener that probes the loopback port at invocation time #when invoked by the flow
   #then the callback server already accepts HTTP requests (ordering guarantee).
3. #given rejecting opener #when the flow attempts the browser open #then the flow rejects
   with a message containing the full authorization URL and closes the callback server.

All three fail fast against current code (opener option ignored / no authorizationUrl in
result / failure swallowed). RED log saved before implementing.

GREEN: implement the fix; same tests pass.

## Gates (run twice consecutively over final tree)

1. bun test packages/mcp-client-core packages/omo-opencode/src/features/mcp-oauth
   packages/omo-opencode/src/cli/mcp-oauth (focused touched areas)
2. bunx tsgo --noEmit -p packages/mcp-client-core/tsconfig.json
3. bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json
4. GIT_MASTER=1 git diff --check
5. Hygiene scan on diff: no `as any`, `@ts-ignore`, `@ts-expect-error`, non-null assertions,
   emojis, empty catch.

## Isolated QA (/tmp/opencode/issue-6724/)

Drive McpOAuthProvider.login() end-to-end against a local mock OAuth server:
- Mock HTTP endpoints: /.well-known/oauth-authorization-server, /register (DCR),
  /authorize (records the redirect target), /token (validates code_verifier via PKCE S256).
- Browser open stubbed via PATH-stubbed xdg-open script that records the URL to a file
  (proves default-opener dispatch) AND an in-process run using the injected opener seam.
- Assert: URL recorded by the opener == authorizationUrl returned/stored for callback
  validation, byte-for-byte; completed callback validates (token issued with matching
  PKCE verifier and state).
- Sandbox: HOME, XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME, XDG_STATE_HOME,
  OPENCODE_CONFIG_DIR all pointed under /tmp/opencode/issue-6724/sandbox. Real
  ~/.config/opencode and real MCP servers never touched (prove by listing sandbox tree).

## Evidence artifacts

README.md, plan.md (this file), red-log.txt, green-log.txt, gates-pass1.txt, gates-pass2.txt,
qa-transcript.txt, qa-mock-server.ts, cleanup-receipt.md.

## Self-audit state machine

Numbered waves; each wave re-reads the fresh full git diff from disk plus adjacent callers
(provider, CLI login, skill-mcp-manager oauth-handler, barrel/shim consumers, teardown/error
paths, platform branches of the opener). Ledger records P0/P1/P2/P3 AND noise findings with
explicit adjudication. Any edit (code/tests/evidence) resets clean_streak=0 and starts a new
full wave. Stop only after TWO consecutive post-final-edit waves with an empty ledger,
recording exact scope and commands per wave.

## Constraints honored

No git commit/push/PR. Never stage packages/shared-skills/upstreams/* submodule churn.
No weakening/deleting existing tests. rg unavailable -> GIT_MASTER=1 git grep. LSP daemon
unavailable -> strict tsgo gate. bun install killed if it hangs after populating node_modules.
No emojis anywhere.
