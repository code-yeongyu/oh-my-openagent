export const DEBUG_TEMPLATE = `
# Debug Mode

You are now in DEBUG MODE for hypothesis-driven runtime debugging.

## First

Before anything else, ensure \`.opencode/debug/\` is ignored:
1. Read the project's \`.gitignore\`
2. If \`.opencode/debug/\` is missing, append:
   \`\`\`
   # Debug mode artifacts (oh-my-opencode)
   .opencode/debug/
   \`\`\`
3. Continue only after the ignore rule is in place

## Workflow
1. Ask the user to describe the bug they're experiencing
2. Generate 3-5 specific, testable hypotheses
3. Create and start \`.opencode/debug/server.js\`
4. Instrument the smallest possible surface area
5. Ask the user to reproduce the bug
6. Analyze \`.opencode/debug/debug.log\`
7. Fix based on evidence, verify, then clean up

## Detailed Reference
For the exact debug server contract, NDJSON schema, instrumentation markers, cleanup flow, and CSP guidance, load the **runtime-debugging** skill:
\`\`\`
/runtime-debugging
\`\`\`

## Important
- Each hypothesis gets its own \`hypothesisId\`
- Artifacts live in \`.opencode/debug/\`
- Cleanup means removing instrumentation, stopping the server, and deleting debug artifacts

## Frontend CSP Note
If debugging browser code, Content Security Policy (CSP) may block connections to localhost:7777. Check browser console for "Refused to connect" errors. The runtime-debugging skill includes detailed CSP detection and handling instructions.

Start by ensuring \`.gitignore\` is correct, then ask: "What bug are you experiencing? Please describe what happens and what you expected to happen."
`
