import type { BuiltinSkill } from "../types"

export const runtimeDebuggingSkill: BuiltinSkill = {
  name: "runtime-debugging",
  description:
    "Debug runtime issues with hypothesis-driven instrumentation. Use for async issues, state problems, race conditions.",
  template: `# Runtime Debugging Skill

Use this skill for runtime-only bugs where static reading is not enough: async timing issues, stale state, race conditions, flaky event ordering, or browser/runtime behavior that needs evidence.

## Workflow

1. Describe the bug precisely.
2. Propose 2-4 hypotheses labeled A, B, C.
3. Add minimal instrumentation for the active hypotheses.
4. Reproduce the issue and collect logs.
5. Analyze the evidence, fix the root cause, verify, then clean up instrumentation.

## Debug Artifacts

- Store temporary artifacts in ".opencode/debug/".
- Ensure ".opencode/debug/" is ignored in ".gitignore".
- Never commit instrumentation or debug artifacts.

## Debug Server

Create ".opencode/debug/server.js" with a tiny local HTTP server that accepts POSTs to "/ingest" and appends NDJSON to ".opencode/debug/debug.log":

\`\`\`javascript
const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.argv[2] || 7777);
const dir = path.join(process.cwd(), ".opencode", "debug");
const logFile = path.join(dir, "debug.log");

fs.mkdirSync(dir, { recursive: true });

http
  .createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", port }));
      return;
    }

    if (req.method === "POST" && req.url === "/ingest") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const entry = JSON.parse(body);
        if (!entry.timestamp) entry.timestamp = Date.now();
        fs.appendFileSync(logFile, JSON.stringify(entry) + "\\n");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      });
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  })
  .listen(port, "127.0.0.1");
\`\`\`

Start it with:

\`\`\`bash
mkdir -p .opencode/debug && node .opencode/debug/server.js
\`\`\`

## NDJSON Schema

Each log line is one JSON object. Use this shape:

\`\`\`json
{
  "hypothesisId": "A",
  "label": "fn-entry",
  "location": "src/app.ts:42",
  "message": "handler entered",
  "data": { "userId": 123 },
  "level": "info",
  "timestamp": 1704067925123
}
\`\`\`

Required fields: "hypothesisId", "label", "location", "message".

## Instrumentation Rules

- Keep instrumentation minimal and hypothesis-driven.
- Wrap every temporary debug block in region markers so cleanup is mechanical.
- Add logs around function entry/exit, async boundaries, state transitions, branch decisions, and error handlers.

Marker format:

- JS/TS/Go/Rust/Java/Kotlin/C/C++: "// @DEBUG:START" ... "// @DEBUG:END"
- Python/Ruby/Bash: "# @DEBUG:START" ... "# @DEBUG:END"
- HTML: "<!-- @DEBUG:START -->" ... "<!-- @DEBUG:END -->"
- CSS: "/* @DEBUG:START */" ... "/* @DEBUG:END */"

Example JS/TS helper:

\`\`\`typescript
// @DEBUG:START
async function __debugLog(
  hypothesisId: string,
  label: string,
  location: string,
  message: string,
  data?: Record<string, unknown>,
) {
  await fetch("http://localhost:7777/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hypothesisId,
      label,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}
// @DEBUG:END
\`\`\`

For other languages, send the same JSON shape to the same endpoint.

## Reproduction And Analysis

Before each run, clear old logs:

\`\`\`bash
: > .opencode/debug/debug.log
\`\`\`

After reproducing, inspect by hypothesis, order, or errors:

\`\`\`bash
cat .opencode/debug/debug.log | jq .
cat .opencode/debug/debug.log | jq 'select(.hypothesisId == "A")'
cat .opencode/debug/debug.log | jq -r '[.timestamp, .hypothesisId, .label, .message] | @tsv' | sort -n
cat .opencode/debug/debug.log | jq 'select(.level == "error")'
\`\`\`

## Cleanup

1. Remove all regions between "@DEBUG:START" and "@DEBUG:END".
2. Verify no markers remain.
3. Stop the server.
4. Delete ".opencode/debug/".
5. Run relevant tests.

\`\`\`bash
grep -r "@DEBUG:" . --include="*.ts" --include="*.js" --include="*.py" --include="*.go"
pkill -f "node .opencode/debug/server.js"
rm -rf .opencode/debug/
\`\`\`

## Frontend Note

If browser instrumentation cannot reach "http://localhost:7777/ingest", inspect Content Security Policy and temporarily allow localhost connections in development only. Revert any non-dev CSP relaxations before finishing.
`,
}
