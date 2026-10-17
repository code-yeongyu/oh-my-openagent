import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** Instrument only the harness's scratch bundle, never a shipped artifact. */
export async function instrumentAcceptance(install, kitDir) {
  const { parse } = await import(join(kitDir, "node_modules/@babel/parser/lib/index.js"))
  const path = join(install.plugin, "extensions/omo.js")
  const source = readFileSync(path, "utf8")
  const ast = parse(source, { sourceType: "module" })
  const edits = []
  let sends = 0
  let admissions = 0
  const log = (fields) => `process.getBuiltinModule("node:fs").appendFileSync(process.env.THREAD_QA_TRACE,JSON.stringify({at:performance.timeOrigin+performance.now(),pid:process.pid,${fields}})+"\\n");`
  const text = (node) => source.slice(node.start, node.end)
  function visit(node) {
    if (node === null || typeof node !== "object") return
    if (node.type === "CallExpression" && node.arguments?.[0]?.value === "thread_send" && node.arguments.length === 5) {
      const args = text(node.arguments[2])
      edits.push({ start: node.start, end: node.end, value: `(async()=>{${log(`event:"tool_enter",args:${args}`)}const __reply=await ${text(node)};${log(`event:"tool_return",args:${args}`)}return __reply})()` })
      sends++
      return
    }
    if (node.type === "CallExpression" && node.callee?.property?.name === "admitExternalMessage") {
      const input = node.arguments[0]
      if (input?.type === "ObjectExpression" && input.properties.some((property) => property.key?.name === "deliverAs")) {
        edits.push({ start: node.start, end: node.end, value: `(()=>{const __input=${text(input)};const __accepted=${text(node.callee)}(__input);${log('event:"target_accept",delivery_id:__input.delivery_id,text:__input.text,kind:__accepted.kind')}return __accepted})()` })
        admissions++
        return
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) visit(child)
      else if (value !== node) visit(value)
    }
  }
  visit(ast)
  if (sends !== 1 || admissions !== 1) throw new Error(`trace anchors: tool=${sends} admission=${admissions}; expected one each`)
  let instrumented = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) instrumented = instrumented.slice(0, edit.start) + edit.value + instrumented.slice(edit.end)
  parse(instrumented, { sourceType: "module" })
  writeFileSync(path, instrumented)
  return { tool_entry: sends, synchronous_target_acceptance: admissions }
}
