# AUTH KNOWLEDGE BASE

## OVERVIEW

Google Antigravity OAuth for Gemini models. Token management, fetch interception, thinking block extraction.

## STRUCTURE

```
auth/
└── antigravity/
    ├── plugin.ts         # Main export, hooks registration (554 lines)
    ├── oauth.ts          # OAuth flow, token acquisition
    ├── token.ts          # Token storage, refresh logic
    ├── fetch.ts          # Fetch interceptor (798 lines)
    ├── response.ts       # Response transformation (599 lines)
    ├── thinking.ts       # Thinking block extraction (755 lines)
    ├── thought-signature-store.ts  # Signature caching
    ├── message-converter.ts        # Format conversion
    ├── accounts.ts       # Multi-account management
    ├── browser.ts        # Browser automation for OAuth
    ├── cli.ts            # CLI interaction
    ├── request.ts        # Request building
    ├── project.ts        # Project ID management
    ├── storage.ts        # Token persistence
    ├── tools.ts          # OAuth tool registration
    ├── constants.ts      # API endpoints, model mappings
    └── types.ts
```

## KEY COMPONENTS

| File | Purpose |
|------|---------|
| fetch.ts | URL rewriting, token injection, retries |
| thinking.ts | Extract `<antThinking>` blocks |
| response.ts | Streaming SSE parsing |
| oauth.ts | Browser-based OAuth flow |
| token.ts | Token persistence, expiry |

## HOW IT WORKS

1. **Intercept**: fetch.ts intercepts Anthropic/Google requests
2. **Rewrite**: URLs → Antigravity proxy endpoints
3. **Auth**: Bearer token from stored OAuth credentials
4. **Response**: Streaming parsed, thinking blocks extracted
5. **Transform**: Normalized for OpenCode

## FEATURES

- Multi-account (up to 10 Google accounts)
- Auto-fallback on rate limit
- Thinking blocks preserved
- Antigravity proxy for AI Studio access

## ANTI-PATTERNS

- Direct API calls (use fetch interceptor)
- Tokens in code (use token.ts storage)
- Ignoring refresh (check expiry first)
- Blocking on OAuth (always async)
