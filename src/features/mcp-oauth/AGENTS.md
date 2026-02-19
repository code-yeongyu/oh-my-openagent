# src/features/mcp-oauth/ — OAuth 2.0 + PKCE + DCR for MCP Servers

**Generated:** 2026-02-19

## OVERVIEW

18 files. Full OAuth 2.0 authorization flow for MCP servers requiring authentication. Implements PKCE (RFC 7636), Dynamic Client Registration (DCR, RFC 7591), and resource indicators (RFC 8707). Used by `bunx oh-my-opencode mcp-oauth login`.

## AUTHORIZATION FLOW

```
1. discovery.ts → fetch /.well-known/oauth-authorization-server
2. dcr.ts → Dynamic Client Registration (if server supports it)
3. oauth-authorization-flow.ts → generate PKCE verifier/challenge
4. callback-server.ts → local HTTP server on random port for redirect
5. Open browser → authorization URL
6. callback-server.ts → receive code + state
7. provider.ts → exchange code for token (with PKCE verifier)
8. storage.ts → persist token to ~/.config/opencode/mcp-oauth/
9. step-up.ts → handle step-up auth if initial token insufficient
```

## KEY FILES

| File | Purpose |
|------|---------|
| `oauth-authorization-flow.ts` | PKCE helpers: `generateCodeVerifier()`, `generateCodeChallenge()`, `buildAuthorizationUrl()` |
| `callback-server.ts` | Local HTTP redirect server — listens for OAuth callback |
| `provider.ts` | `OAuthProvider` — token exchange, refresh, revoke |
| `discovery.ts` | Fetch + parse OAuth server metadata from well-known endpoint |
| `dcr.ts` | Dynamic Client Registration — register this app with OAuth server |
| `resource-indicator.ts` | RFC 8707 resource indicator handling |
| `step-up.ts` | Handle step-up authentication challenges |
| `storage.ts` | Persist tokens to `~/.config/opencode/mcp-oauth/{server-hash}.json` |
| `schema.ts` | Zod schemas for OAuth server metadata, token response, DCR |

## PKCE IMPLEMENTATION

- Code verifier: 32 random bytes → base64url (no padding)
- Code challenge: SHA-256(verifier) → base64url
- Method: `S256`

## TOKEN STORAGE

Location: `~/.config/opencode/mcp-oauth/` — one JSON file per MCP server (keyed by server URL hash).
Fields: `access_token`, `refresh_token`, `expires_at`, `client_id`.

## CLI COMMANDS

```bash
bunx oh-my-opencode mcp-oauth login <server-url>   # Full PKCE flow
bunx oh-my-opencode mcp-oauth logout <server-url>  # Revoke + delete token
bunx oh-my-opencode mcp-oauth status               # List stored tokens
```
