# Data Scraping Guide

For large datasets (followers, posts, search results), **intercept and replay network requests** rather than scrolling and parsing the DOM. This is faster, more reliable, and handles pagination automatically.

## Why Not Scroll?

Scrolling is slow, unreliable, and wastes time. APIs return structured data with pagination built in. Always prefer API replay.

## Start Small, Then Scale

**Don't try to automate everything at once.** Work incrementally:

1. **Capture one request** - verify you're intercepting the right endpoint
2. **Inspect one response** - understand the schema before writing extraction code
3. **Extract a few items** - make sure your parsing logic works
4. **Then scale up** - add pagination loop only after the basics work

This prevents wasting time debugging a complex script when the issue is a simple path like `data.user.timeline` vs `data.user.result.timeline`.

## Step-by-Step Workflow

### 1. Capture Request Details

First, intercept a request to understand URL structure and required headers:

```typescript
import { connect, waitForPageLoad } from "@/client.js";
import * as fs from "node:fs";

const client = await connect();
const page = await client.page("site");

let capturedRequest = null;
page.on("request", (request) => {
  const url = request.url();
  // Look for API endpoints (adjust pattern for your target site)
  if (url.includes("/api/") || url.includes("/graphql/")) {
    capturedRequest = {
      url: url,
      headers: request.headers(),
      method: request.method(),
    };
    fs.writeFileSync("tmp/request-details.json", JSON.stringify(capturedRequest, null, 2));
    console.log("Captured request:", url.substring(0, 80) + "...");
  }
});

await page.goto("https://example.com/profile");
await waitForPageLoad(page);
await page.waitForTimeout(3000);

await client.disconnect();
```

### 2. Capture Response to Understand Schema

Save a raw response to inspect the data structure:

```typescript
page.on("response", async (response) => {
  const url = response.url();
  if (url.includes("UserTweets") || url.includes("/api/data")) {
    const json = await response.json();
    fs.writeFileSync("tmp/api-response.json", JSON.stringify(json, null, 2));
    console.log("Captured response");
  }
});
```

Then analyze the structure to find:

- Where the data array lives (e.g., `data.user.result.timeline.instructions[].entries`)
- Where pagination cursors are (e.g., `cursor-bottom` entries)
- What fields you need to extract

### 3. Replay API with Pagination

Once you understand the schema, replay requests directly:

```typescript
import { connect } from "@/client.js";
import * as fs from "node:fs";

const client = await connect();
const page = await client.page("site");

const results = new Map(); // Use Map for deduplication
const headers = JSON.parse(fs.readFileSync("tmp/request-details.json", "utf8")).headers;
const baseUrl = "https://example.com/api/data";

let cursor = null;
let hasMore = true;

while (hasMore) {
  // Build URL with pagination cursor
  const params = { count: 20 };
  if (cursor) params.cursor = cursor;
  const url = `${baseUrl}?params=${encodeURIComponent(JSON.stringify(params))}`;

  // Execute fetch in browser context (has auth cookies/headers)
  const response = await page.evaluate(
    async ({ url, headers }) => {
      const res = await fetch(url, { headers });
      return res.json();
    },
    { url, headers }
  );

  // Extract data and cursor (adjust paths for your API)
  const entries = response?.data?.entries || [];
  for (const entry of entries) {
    if (entry.type === "cursor-bottom") {
      cursor = entry.value;
    } else if (entry.id && !results.has(entry.id)) {
      results.set(entry.id, {
        id: entry.id,
        text: entry.content,
        timestamp: entry.created_at,
      });
    }
  }

  console.log(`Fetched page, total: ${results.size}`);

  // Check stop conditions
  if (!cursor || entries.length === 0) hasMore = false;

  // Rate limiting - be respectful
  await new Promise((r) => setTimeout(r, 500));
}

// Export results
const data = Array.from(results.values());
fs.writeFileSync("tmp/results.json", JSON.stringify(data, null, 2));
console.log(`Saved ${data.length} items`);

await client.disconnect();
```

## Key Patterns

| Pattern                 | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| `page.on('request')`    | Capture outgoing request URL + headers                 |
| `page.on('response')`   | Capture response data to understand schema             |
| `page.evaluate(fetch)`  | Replay requests in browser context (inherits auth)     |
| `Map` for deduplication | APIs often return overlapping data across pages        |
| Cursor-based pagination | Look for `cursor`, `next_token`, `offset` in responses |

## Tips

- **Extension mode**: `page.context().cookies()` doesn't work - capture auth headers from intercepted requests instead
- **Rate limiting**: Add 500ms+ delays between requests to avoid blocks
- **Stop conditions**: Check for empty results, missing cursor, or reaching a date/ID threshold
- **GraphQL APIs**: URL params often include `variables` and `features` JSON objects - capture and reuse them
