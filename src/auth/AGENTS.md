# AUTH KNOWLEDGE BASE

## OVERVIEW

Google Antigravity OAuth implementation for Gemini models. Token management, fetch interception, thinking block extraction, and response transformation.

## STRUCTURE

```
auth/
└── antigravity/
    ├── plugin.ts         # Main plugin export, hooks registration
    ├── oauth.ts          # OAuth flow, token acquisition
    ├── token.ts          # Token storage, refresh logic
    ├── fetch.ts          # Fetch interceptor (622 lines) - URL rewriting, retry
    ├── response.ts       # Response transformation, streaming
    ├── thinking.ts       # Thinking block extraction/transformation
    ├── thought-signature-store.ts  # Signature caching for thinking blocks
    ├── message-converter.ts        # Message format conversion
    ├── request.ts        # Request building, headers
    ├── project.ts        # Project ID management
    ├── tools.ts          # Tool registration for OAuth
    ├── constants.ts      # API endpoints, model mappings
    └── types.ts          # TypeScript interfaces
```

## KEY COMPONENTS

| File | Purpose |
|------|---------|
| `fetch.ts` | Core interceptor - rewrites URLs, manages tokens, handles retries |
| `thinking.ts` | Extracts `<antThinking>` blocks, transforms for OpenCode compatibility |
| `response.ts` | Handles streaming responses, SSE parsing |
| `oauth.ts` | Browser-based OAuth flow for Google accounts |
| `token.ts` | Token persistence, expiry checking, refresh |

## HOW IT WORKS

1. **Intercept**: `fetch.ts` intercepts requests to Anthropic/Google endpoints
2. **Rewrite**: URLs rewritten to Antigravity proxy endpoints
3. **Auth**: Bearer token injected from stored OAuth credentials
4. **Response**: Streaming responses parsed, thinking blocks extracted
5. **Transform**: Response format normalized for OpenCode consumption

## ANTI-PATTERNS (AUTH)

- **Direct API calls**: Always go through fetch interceptor
- **Storing tokens in code**: Use `token.ts` storage layer
- **Ignoring refresh**: Check token expiry before requests
- **Blocking on OAuth**: OAuth flow is async, never block main thread

## NOTES

- **Multi-account**: Supports up to 10 Google accounts for load balancing
- **Fallback**: On rate limit, automatically switches to next available account
- **Thinking blocks**: Preserved and transformed for extended thinking features
- **Proxy**: Uses Antigravity proxy for Google AI Studio access
