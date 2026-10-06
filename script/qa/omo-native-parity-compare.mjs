// Pure comparison of two parity runs (the standalone binary against the npm launcher).

export const PARITY_STEPS = [
  { id: "eval-js", tool: "eval", arguments: { language: "js", code: "print(6 * 7)", summary: "parity js" } },
  { id: "eval-py", tool: "eval", arguments: { language: "py", code: "print(6 * 7)", summary: "parity python" } },
  { id: "grep", tool: "eval", arguments: { language: "js", code: "const r = await tool.grep({ pattern: 'omo-parity-needle', path: '.' }); print(r.text.split('\\n')[0])", summary: "parity grep" } },
  { id: "pty-bash", tool: "eval", arguments: { language: "js", code: "const r = await tool.bash({ command: 'echo parity-$((6*7))' }); print(r.text)", summary: "parity bash" } },
  { id: "ast-grep", tool: "eval", arguments: { language: "js", code: "const r = await tool.tool_search({ query: 'ast grep structural search' }); print(r.text.split('\\n')[0])", summary: "parity tool search" } },
  { id: "webfetch", tool: "webfetch", arguments: { url: "{{PAGE_URL}}", format: "markdown" } },
  { id: "read-text", tool: "read", arguments: { path: "notes.txt" } },
  { id: "read-image", tool: "read", arguments: { path: "pixel.png" } },
  { id: "lsp", tool: "lsp_diagnostics", arguments: { filePath: "sample.ts" } },
  { id: "apply-patch", tool: "apply_patch", arguments: { input: "*** Begin Patch\n*** Add File: added.ts\n+export const added = 42\n*** End Patch" } },
  { id: "memory", tool: "memory", arguments: { command: "create", reason: "parity", file_path: "reference/parity.md", description: "parity note", file_text: "parity 42" } },
  { id: "task", tool: "task", arguments: { prompt: "parity child", category: "quick", task_summary: "parity child", run_in_background: false } },
]

// Lines doctor prints only on one distribution by design, each with the reason it is expected.
export const DOCTOR_EXPECTED_ONLY = {
  npm: [
    ["PASS senpi CLI", "npm resolves an installed engine package; the binary embeds it"],
    ["PASS senpi version", "npm checks the installed engine version; the binary's version line carries the pin"],
    ["INFO omo · Edition", "npm version line; the binary prints its own version line"],
    ["WARN engine pid", "npm lists engines started before its payload was installed"],
    ["INFO restart those sessions", "follows the npm engine-pid warning"],
    ["INFO computer use engine", "npm downloads the desktop engine on first use"],
  ],
  binary: [
    ["INFO omo ", "the binary's version line"],
    ["PASS computer use ", "the binary embeds the desktop engine, so its probe runs"],
    ["WARN computer use ", "results of that probe (permissions, display) on the runner"],
    ["INFO computer use stop path", "reported once the embedded engine answers"],
    ["INFO Claude Code", "the binary pins the Claude Code it downloads for the anthropic-subscription lane (#9262); npm has no pin"],
    ["PASS Claude Code", "the same pinned Claude Code, once it is downloaded"],
  ],
}

const VOLATILE = [
  [/\b[0-9a-f]{7,40}\b/g, "<sha>"],
  [/elapsedMs=\d+/g, "elapsedMs=<n>"],
  [/searched=\d+/g, "searched=<n>"],
  [/\d+(\.\d+)?ms\b/g, "<n>ms"],
]

export function normalizeText(text, roots = []) {
  let value = String(text ?? "")
  for (const root of roots.filter(Boolean).sort((a, b) => b.length - a.length)) value = value.split(root).join("<root>")
  for (const [pattern, replacement] of VOLATILE) value = value.replace(pattern, replacement)
  return value.trim()
}

// A doctor/setup line's identity: its level and label, not the machine-specific detail after it.
export function sectionKey(line) {
  const shard = /^INFO Shard\b/.exec(line.trim())
  if (shard) return "INFO Shard"
  const match = /^(PASS|WARN|FAIL|INFO|NOTICE)\s+([^:]+?)(:|$)/.exec(line.trim())
  if (match) return `${match[1]} ${match[2].trim()}`
  return line.trim().replace(/\d+/g, "<n>")
}

function expectedOnly(line, side) {
  return DOCTOR_EXPECTED_ONLY[side].some(([prefix]) => line.trim().startsWith(prefix))
}

export function compareLines(label, binaryLines, npmLines) {
  const differences = []
  const binaryKeys = new Set(binaryLines.filter((line) => line.trim() && !expectedOnly(line, "binary")).map(sectionKey))
  const npmKeys = new Set(npmLines.filter((line) => line.trim() && !expectedOnly(line, "npm")).map(sectionKey))
  for (const key of npmKeys) if (!binaryKeys.has(key)) differences.push(`${label}: npm prints "${key}", the binary does not`)
  for (const key of binaryKeys) if (!npmKeys.has(key)) differences.push(`${label}: the binary prints "${key}", npm does not`)
  return differences
}

// A leg with no npm launcher to compare against (the Windows runner) still has to prove that the
// binary, started from an empty download folder, runs the engine: its eval and pty steps succeed and
// no extension fails to load (#7485).
export const BINARY_ONLY_REQUIRED_STEPS = ["eval-js", "pty-bash"]

export function binaryOnlyFailures(label, run) {
  const failures = []
  if (run.exitCodes.session !== 0) failures.push(`${label}: session exited ${run.exitCodes.session}`)
  for (const id of BINARY_ONLY_REQUIRED_STEPS) {
    const result = run.results[id]
    if (result === undefined) failures.push(`${label}: ${id} returned no result`)
    else if (result.isError) failures.push(`${label}: ${id} failed "${result.text.slice(0, 200)}"`)
  }
  for (const warning of run.extensionFailures) failures.push(`${label}: ${warning}`)
  return failures
}

export function compareRuns(binary, npm) {
  const differences = []
  const binaryTools = new Set(binary.tools)
  const npmTools = new Set(npm.tools)
  for (const tool of npmTools) if (!binaryTools.has(tool)) differences.push(`tools: npm registers "${tool}", the binary does not`)
  for (const tool of binaryTools) if (!npmTools.has(tool)) differences.push(`tools: the binary registers "${tool}", npm does not`)
  for (const step of PARITY_STEPS) {
    const left = binary.results[step.id]
    const right = npm.results[step.id]
    if (left === undefined || right === undefined) {
      differences.push(`${step.id}: no result from ${left === undefined ? "the binary" : "npm"}`)
      continue
    }
    if (left.isError !== right.isError || left.text !== right.text) {
      differences.push(`${step.id}: binary ${left.isError ? "error" : "ok"} "${left.text.slice(0, 200)}" vs npm ${right.isError ? "error" : "ok"} "${right.text.slice(0, 200)}"`)
    }
  }
  differences.push(...compareLines("doctor", binary.doctor, npm.doctor))
  differences.push(...compareLines("setup", binary.setup, npm.setup))
  for (const [side, run] of [["binary", binary], ["npm", npm]]) {
    for (const warning of run.extensionFailures) differences.push(`${side}: ${warning}`)
  }
  return differences
}
