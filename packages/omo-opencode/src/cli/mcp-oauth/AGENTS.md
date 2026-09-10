# src/cli/mcp-oauth/ — MCP OAuth CLI Adapter

Earned its file: score 9, distinct domain — the CLI boundary for an authentication flow whose implementation lives in `src/features/mcp-oauth/`.

## OVERVIEW

Commander adapter for MCP OAuth lifecycle operations. `createMcpOAuthCommand()` builds the `mcp` command with a nested `oauth` group whose `login <server-name>`, `logout <server-name>`, and `status [server-name]` subcommands call the feature-level OAuth implementation.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Command registration | `index.ts` (`createMcpOAuthCommand`) |
| Authorization flow | `login.ts` |
| Token removal | `logout.ts` |
| Token inspection | `status.ts` |
| Regression coverage | Co-located `*.test.ts` files |

## CONVENTIONS

- Handlers return an exit code; the adapter owns process termination after Commander dispatch.
- Keep PKCE, discovery, token storage, and refresh logic in `src/features/mcp-oauth/`; this directory is only the CLI boundary.
- Preserve subcommand names and their server-name argument shape because scripts and tests inspect the Commander tree.
- Tests inspect command registration and invoke handlers with isolated temporary configuration.

## RELATED

| Where | What |
|-------|------|
| `src/features/mcp-oauth/` | Discovery, DCR, PKCE, token storage, refresh, and step-up implementation |
| `src/cli/cli-program.ts` | Attaches this command tree to the root program |

## ANTI-PATTERNS

- Do not implement a second OAuth flow here.
- Do not print access or refresh tokens in command output.
- Do not bypass the feature storage and provider abstractions when adding a command option.
