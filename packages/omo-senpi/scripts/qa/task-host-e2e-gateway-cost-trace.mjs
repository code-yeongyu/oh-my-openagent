/**
 * Tool timing at the tool boundary for the gateway cost driver: `thread_list`'s execute wrapper in
 * the harness's scratch COPY of the bundle (never a shipped artifact) logs `tool_enter` and
 * `tool_return` to `$THREAD_QA_TRACE`, beside the `thread_send` entry and synchronous target
 * acceptance records `gateway-acceptance-trace.mjs` adds. A model round trip is never part of the
 * measured interval.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { instrumentAcceptance } from "./gateway-acceptance-trace.mjs"

const record = (fields) => `process.getBuiltinModule("node:fs").appendFileSync(process.env.THREAD_QA_TRACE,JSON.stringify({at:performance.timeOrigin+performance.now(),pid:process.pid,${fields}})+"\\n");`

/** Wrap the one `<tool>` execute call (`run("<tool>", toolCallId, params, signal, body)`) with entry/return records. */
async function instrumentToolBoundary(install, kitDir, tool) {
  const { parse } = await import(join(kitDir, "node_modules/@babel/parser/lib/index.js"))
  const path = join(install.plugin, "extensions/omo.js")
  const source = readFileSync(path, "utf8")
  const edits = []
  const visit = (node) => {
    if (node === null || typeof node !== "object") return
    if (node.type === "CallExpression" && node.arguments?.[0]?.value === tool && node.arguments.length === 5) {
      const call = source.slice(node.start, node.end)
      edits.push({ start: node.start, end: node.end, value: `(async()=>{${record(`event:"tool_enter",tool:${JSON.stringify(tool)}`)}const __reply=await ${call};${record(`event:"tool_return",tool:${JSON.stringify(tool)}`)}return __reply})()` })
      return
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) visit(child)
      else if (value !== node) visit(value)
    }
  }
  visit(parse(source, { sourceType: "module" }))
  if (edits.length !== 1) throw new Error(`${tool} trace anchor matched ${edits.length} sites; expected 1`)
  const [edit] = edits
  const instrumented = source.slice(0, edit.start) + edit.value + source.slice(edit.end)
  parse(instrumented, { sourceType: "module" })
  writeFileSync(path, instrumented)
  return 1
}

export async function instrumentGatewayTools(install, kitDir) {
  const acceptance = await instrumentAcceptance(install, kitDir)
  return { ...acceptance, thread_list_entry: await instrumentToolBoundary(install, kitDir, "thread_list") }
}

export function traceRecords(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
}
