// Mock-model steps for the live macOS control drivers. Computer use has no code cell of its own: one step is one
// `computer` call chain, a multi-step body is one eval cell of computer helpers. A cell's body may name the helpers
// `desktop` and `wait`, as the drivers wrote them; the computer global appears in the cell after the tool's first call.

export const chain = (...steps) => ({
  type: "tool_call",
  name: "computer",
  arguments: { action: "call", chain: steps },
})

export const cell = (body) => ({
  type: "tool_call",
  name: "eval",
  arguments: {
    language: "js",
    summary: "computer control QA",
    code: `const desktop = computer; const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));\n${body}`,
  },
})
