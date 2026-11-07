# Secrets and configuration

A secret is any value whose exposure lets someone act as you or read what you can read: API keys, tokens, passwords, private keys, session cookies, signed URLs, OAuth state. The rules below hold for application code and for the agent's own work alike.

## 1. Where a secret may live

- In the environment of the process that needs it, set by the shell, a secret manager, or the CI's secret store.
- In a file created with mode `0600` on the consuming host, written through a pipe from the producing command, never through a string in a script.
- In the harness's credential store, read through its sanctioned API.

Nowhere else. Not in code, not in a config file checked into git, not in a `.env` that is tracked, not in an issue, a PR, a commit message, a log line, a prompt, a tool argument, a screenshot, or a chat message. Tool arguments are logged; a secret passed as one is a secret in a transcript.

## 2. Handling

- Mint-and-store in one pipe: `create-key ... | install --stdin` on the consuming host, printing only the error field on failure. The create response is both a diagnosis and a credential; it is never pasted into a reply.
- Reference, do not copy: config carries `${ENV_VAR}` or a secret-manager reference; the value resolves at load time.
- Redact at the boundary that logs: a logger that receives a request object masks headers, cookies and tokens before writing; redaction added in the formatter is too late when a second sink exists.
- Rotate on exposure, not on suspicion of exposure settling down: a key that appeared in a log or a transcript is rotated and the old one revoked, then the leak path is fixed.
- Scope: one credential per consumer and per purpose, with an expiry. A shared key across services turns one compromise into all of them.
- Never search for secrets. A script or an agent that greps files, memory, logs or transcripts for keys is itself an exfiltration path; credentials are obtained through the sanctioned store or by asking the owner.

## 3. Configuration that behaves like a secret

Session cookies, CSRF tokens, upload policy fields, signed URLs, OAuth client secrets, webhook signing keys, and the `env` block of an MCP server entry are secrets with other names. A screenshot or a copied request that contains one is handled as a secret. Headers and query strings that carry tokens are excluded from access logs.

## 4. Headers, CORS, CSP, rate limits

- CORS: an explicit origin list; never `*` with credentials.
- CSP: a nonce- or hash-based policy on pages that render user content; `unsafe-inline` is a finding, not a default.
- Cookies: `HttpOnly`, `Secure`, `SameSite` set deliberately for the flow; the session cookie is never readable by scripts.
- Rate limits on authentication, password reset, OTP, and any endpoint that costs money or sends mail.
- Security headers (`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, frame restrictions) set once at the edge and checked with one request in the review.

## 5. Checking before the claim

`gitleaks` (or the repository's secret scanner) on the diff and on the history of the touched files, a grep of the PR body and the issue text for anything shaped like a token, and a read of every log line the change adds. The review quotes the scanner's result line; a clean scan with a token in a comment is still a finding.
