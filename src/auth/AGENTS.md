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
    ├── response.ts       # Response transformation (598 lines)
    ├── thinking.ts       # Thinking block extraction (755 lines)
    ├── thought-signature-store.ts  # Signature caching
    ├── message-converter.ts        # Format conversion
    ├── accounts.ts       # Multi-account management (up to 10 accounts)
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
| fetch.ts | URL rewriting, multi-account rotation, endpoint fallback |
| thinking.ts | Thinking block extraction, signature management, budget mapping |
| response.ts | Streaming SSE parsing and response transformation |
| accounts.ts | Load balancing across up to 10 Google accounts |
| thought-signature-store.ts | Caching signatures for multi-turn thinking conversations |

## HOW IT WORKS
1. **Intercept**: `fetch.ts` intercepts Anthropic/Google requests.
2. **Route**: Rotates accounts and selects best endpoint (daily → autopush → prod).
3. **Auth**: Injects Bearer tokens from `token.ts` persistence.
4. **Process**: `response.ts` parses SSE; `thinking.ts` manages thought blocks.
5. **Recovery**: Detects GCP permission errors and triggers recovery/rotation.

## FEATURES
- Multi-account load balancing (up to 10 accounts)
- Strategic endpoint fallback: daily → autopush → prod
- Persistent thought signatures for continuity in thinking models
- Automated GCP permission error recovery

## ANTI-PATTERNS
- Hardcoding endpoints: Use `constants.ts` or let `fetch.ts` route.
- Manual token handling: Use `token.ts` and `storage.ts` abstraction.
- Sync OAuth calls: All auth flows must be non-blocking/async.
- Ignoring account rotation: Let `fetch.ts` handle load balancing.
