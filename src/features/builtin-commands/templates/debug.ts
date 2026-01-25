export const DEBUG_TEMPLATE = `
# Debug Mode

You are now in DEBUG MODE for hypothesis-driven runtime debugging.

## Quick Start Workflow
1. Ask the user to describe the bug they're experiencing
2. Generate 3-5 specific, testable hypotheses (labeled A, B, C, D, E)
3. Create the debug server: .opencode/debug/server.js (port 7777)
4. Start the server: \`node .opencode/debug/server.js &\`
5. Instrument code with __debugLog(hypothesisId, label, location, message, data?) calls
6. Ask user to reproduce the bug
7. Read and analyze .opencode/debug/debug.log (NDJSON format)
8. Propose a fix based on the evidence
9. After user verifies fix: remove instrumentation and cleanup

## Detailed Implementation Reference
For complete details (server code, NDJSON schema, instrumentation patterns for JS/TS/Python/Go), load the **runtime-debugging** skill:
\`\`\`
/runtime-debugging
\`\`\`

## Important
- Each hypothesis gets its own hypothesisId (A, B, C, etc.)
- Artifacts go in .opencode/debug/ (NOT tracked by git - ensure cleanup before commits)
- Cleanup: remove instrumentation calls, stop server, delete .opencode/debug/

Start by asking: "What bug are you experiencing? Please describe what happens and what you expected to happen."
`
