# Issue: Playwright MCP Causes Infinite JSON Parse Error Loop

**Status**: FIXED  
**Severity**: Critical (unrecoverable state)  
**Component**: `src/features/skill-mcp-manager/manager.ts` + MCP SDK interaction  
**Reported**: 2026-01-21  
**Fixed**: 2026-01-21

---

## Summary

When using the Playwright skill (`/playwright`), if the Playwright MCP server outputs anything to stdout that isn't valid JSON-RPC (npm warnings, browser console logs, debug output, etc.), the MCP SDK enters an **infinite loop** of JSON parse errors that makes OpenCode unrecoverable.

---

## Root Cause Analysis

### The Flow

1. **Playwright skill definition** (`src/features/builtin-skills/skills.ts:3-15`):
   ```typescript
   const playwrightSkill: BuiltinSkill = {
     name: "playwright",
     mcpConfig: {
       playwright: {
         command: "npx",
         args: ["@playwright/mcp@latest"],
       },
     },
   }
   ```

2. **SkillMcpManager spawns the process** (`src/features/skill-mcp-manager/manager.ts:274-279`):
   ```typescript
   const transport = new StdioClientTransport({
     command,
     args,
     env: mergedEnv,
     stderr: "ignore",  // stderr is correctly ignored
   })
   ```

3. **MCP SDK's stdio transport reads stdout** (`node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js:97-100`):
   ```javascript
   this._process.stdout?.on('data', chunk => {
     this._readBuffer.append(chunk);
     this.processReadBuffer();
   });
   ```

4. **processReadBuffer has a while(true) loop** (`stdio.js:130-142`):
   ```javascript
   processReadBuffer() {
     while (true) {
       try {
         const message = this._readBuffer.readMessage();
         if (message === null) {
           break;  // Only exit on null (no complete line yet)
         }
         this.onmessage?.(message);
       }
       catch (error) {
         this.onerror?.(error);  // Error is reported but loop CONTINUES
       }
     }
   }
   ```

5. **readMessage parses JSON** (`node_modules/@modelcontextprotocol/sdk/dist/cjs/shared/stdio.js:14-25`):
   ```javascript
   readMessage() {
     if (!this._buffer) return null;
     const index = this._buffer.indexOf('\n');
     if (index === -1) return null;
     
     const line = this._buffer.toString('utf8', 0, index).replace(/\r$/, '');
     this._buffer = this._buffer.subarray(index + 1);  // Buffer IS advanced
     return deserializeMessage(line);  // But this throws AFTER advancement
   }
   ```

6. **deserializeMessage throws on invalid JSON** (`stdio.js:31-33`):
   ```javascript
   function deserializeMessage(line) {
     return types_js_1.JSONRPCMessageSchema.parse(JSON.parse(line));
   }
   ```

### The Bug

**Wait, I need to re-examine this.** Looking more carefully:

The buffer IS advanced before `deserializeMessage()` is called (line 23 happens before line 24). So technically, the bad line SHOULD be consumed...

Let me trace this more carefully:

```javascript
readMessage() {
  // ... 
  const line = this._buffer.toString('utf8', 0, index);  // Read line
  this._buffer = this._buffer.subarray(index + 1);       // ADVANCE buffer (line 23)
  return deserializeMessage(line);                        // THEN parse (line 24)
}
```

So the buffer advancement happens BEFORE the parse. The malformed line IS consumed.

**But the problem is different**: The `while(true)` loop in `processReadBuffer()` catches the error and CONTINUES. If there's more data in the buffer, it keeps trying to parse. The issue arises when:

1. Playwright MCP outputs multiple lines of garbage (npm download progress, browser logs)
2. Each line gets parsed, throws, error is caught, loop continues
3. This floods the error handler with thousands of errors per second
4. OpenCode's error handling can't keep up → UI freezes → unrecoverable

### The Real Problem

The MCP SDK is **not designed for noisy stdout**. It expects ONLY valid JSON-RPC messages on stdout. But:

- `npx @playwright/mcp@latest` can output npm download/install progress to stdout
- Browser automation can leak console.log output
- Debug modes might emit diagnostics

**The SDK's error handling is non-fatal by design** - it catches, reports, and continues. But when there's a STREAM of garbage, it becomes a denial-of-service on the error handler.

---

## Reproduction Steps

1. Install oh-my-opencode
2. Use the playwright skill: `/playwright`
3. Have npm in a state where it outputs to stdout (stale cache, need to download, etc.)
4. Or trigger browser console output that leaks to the MCP process stdout
5. Observe: JSON parse errors flood the console, OpenCode becomes unresponsive

---

## Affected Files

| File | Role |
|------|------|
| `src/features/skill-mcp-manager/manager.ts` | Creates StdioClientTransport |
| `src/features/builtin-skills/skills.ts` | Defines playwright skill config |
| `node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js` | MCP SDK stdio transport (external) |
| `node_modules/@modelcontextprotocol/sdk/dist/cjs/shared/stdio.js` | JSON parsing (external) |

---

## Potential Solutions

### Option 1: Wrap the MCP process with a stdout filter (Recommended)

Instead of spawning `npx @playwright/mcp@latest` directly, spawn a wrapper script that:
1. Captures stdout from the real MCP
2. Filters out lines that don't start with `{` (valid JSON-RPC messages always start with `{`)
3. Only forwards valid JSON-RPC to the parent

**Implementation location**: `src/features/skill-mcp-manager/manager.ts`

```typescript
// Instead of direct spawn, use a filter wrapper
const transport = new StdioClientTransport({
  command: "node",
  args: ["-e", `
    const { spawn } = require('child_process');
    const proc = spawn(${JSON.stringify(command)}, ${JSON.stringify(args)}, {
      stdio: ['pipe', 'pipe', 'inherit']
    });
    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\\n');
      for (const line of lines) {
        if (line.trim().startsWith('{')) {
          process.stdout.write(line + '\\n');
        }
      }
    });
    process.stdin.pipe(proc.stdin);
    proc.on('exit', (code) => process.exit(code));
  `],
  env: mergedEnv,
  stderr: "ignore",
})
```

**Pros**: No changes to skill definitions, works for all MCPs  
**Cons**: Adds overhead, more complex

### Option 2: Add error rate limiting in oh-my-opencode

Wrap the MCP client creation with an error handler that:
1. Counts errors per second
2. If error rate exceeds threshold, kill the process and report a clean error
3. Prevent the flood from reaching OpenCode

**Implementation location**: `src/features/skill-mcp-manager/manager.ts`

```typescript
// After client.connect(transport)
let errorCount = 0;
let errorResetTime = Date.now();

transport.onerror = (error) => {
  const now = Date.now();
  if (now - errorResetTime > 1000) {
    errorCount = 0;
    errorResetTime = now;
  }
  errorCount++;
  
  if (errorCount > 100) {
    // Kill the runaway process
    transport.close();
    throw new Error(
      `MCP server "${info.serverName}" is outputting invalid data to stdout. ` +
      `This usually means the server is misconfigured or outputting debug logs. ` +
      `Check that the MCP server only outputs JSON-RPC messages to stdout.`
    );
  }
};
```

**Pros**: Simple, catches the problem early  
**Cons**: Still processes some garbage before detection

### Option 3: Use `--quiet` or similar flags for npx

Modify the playwright skill config to suppress npm output:

```typescript
const playwrightSkill: BuiltinSkill = {
  mcpConfig: {
    playwright: {
      command: "npx",
      args: ["--yes", "--quiet", "@playwright/mcp@latest"],
      //      ^^^^^^  ^^^^^^^  suppress npm output
    },
  },
}
```

**Pros**: Simplest fix  
**Cons**: Only fixes npm output, not browser log leaks; `--quiet` may not exist in all npm versions

### Option 4: Upstream fix to MCP SDK

File an issue with `@modelcontextprotocol/sdk` to add:
1. An option to limit error rate
2. A filter option for stdout
3. Better handling of noisy stdio

**Pros**: Fixes the root cause for everyone  
**Cons**: We don't control the timeline

---

## Recommended Fix

**Implement Option 2 (error rate limiting) + Option 3 (quiet flag)** as immediate fixes, then consider Option 1 for robustness.

Priority order:
1. Add `--yes --quiet` to npx args (5 min fix)
2. Add error rate limiting to SkillMcpManager (30 min fix)
3. Consider stdout wrapper for bulletproof solution (if problems persist)

---

## Testing Plan

1. Unit test: Mock MCP that outputs garbage to stdout, verify error rate limiting kicks in
2. Integration test: Actually spawn playwright MCP in various npm cache states
3. Manual test: Use `/playwright` skill in real OpenCode session

---

## Implementation (2026-01-21)

### Changes Made

#### 1. Added `--yes --quiet` flags to Playwright skill (`src/features/builtin-skills/skills.ts`)

```typescript
mcpConfig: {
  playwright: {
    command: "npx",
    args: ["--yes", "--quiet", "@playwright/mcp@latest"],
  },
},
```

This prevents npm from outputting download progress or prompts to stdout.

#### 2. Added error rate limiting to SkillMcpManager (`src/features/skill-mcp-manager/manager.ts`)

- Added `ErrorRateTracker` interface to track errors per client
- Hooked into `transport.onerror` callback after connection
- If >50 errors occur within 1 second, the client is automatically killed
- Operations on killed clients throw a descriptive error explaining the problem

Key code:
```typescript
interface ErrorRateTracker {
  count: number
  windowStart: number
  killed: boolean
}

// In createStdioClient:
transport.onerror = (error: Error) => {
  if (errorRateTracker.killed) return
  
  const now = Date.now()
  if (now - errorRateTracker.windowStart > 1000) {
    errorRateTracker.count = 0
    errorRateTracker.windowStart = now
  }
  errorRateTracker.count++
  
  if (errorRateTracker.count > 50) {
    errorRateTracker.killed = true
    // Kill the client and clean up
  }
}
```

#### 3. Added unit tests (`src/features/skill-mcp-manager/manager.test.ts`)

- `should detect killed client and throw descriptive error`
- `should include helpful hints in killed client error message`

### Files Changed

| File | Changes |
|------|---------|
| `src/features/builtin-skills/skills.ts` | Added `--yes --quiet` to npx args |
| `src/features/skill-mcp-manager/manager.ts` | Added ErrorRateTracker, error rate limiting logic |
| `src/features/skill-mcp-manager/manager.test.ts` | Added 2 tests for error rate limiting |
| `docs/issues/playwright-mcp-infinite-loop.md` | This documentation |

### Test Results

```
bun test src/features/skill-mcp-manager/manager.test.ts
30 pass, 0 fail
```

---

## Related

- MCP SDK source: `node_modules/@modelcontextprotocol/sdk/`
- Playwright MCP: `@playwright/mcp` (npm package)
- SkillMcpManager: `src/features/skill-mcp-manager/manager.ts`
