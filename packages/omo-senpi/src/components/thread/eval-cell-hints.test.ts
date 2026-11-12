import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { threadToolParamSchemas } from "./contracts"

/**
 * Thread tools are eval-only since #12903. A model-facing sentence that names a bare "thread_list" sends the model
 * to a tool it cannot call directly, and one that writes a call with an argument the tool does not take gets
 * invalid_arguments back: either costs a turn.
 */
const SCHEMAS: Record<string, { properties: Record<string, unknown> }> = threadToolParamSchemas
// Tests and their support files are not model-facing; the parameter schemas are shared with the `omo thread` CLI
// and say which tool produced a value, not which one to run.
const NOT_SCANNED = /\.test\.ts$|(^|\/)testing\/|-fixture\.ts$|^contracts\//

const transpiler = new Bun.Transpiler({ loader: "ts" })
const LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g
const BARE_TOOL = /(?<!tool\.)\bthread_[a-z_]+\b/g
const EVAL_FORM = /tool\.(thread_[a-z_]+)(?:\(\{([^}]*)\}\))?/g

/**
 * A file's code without comments and types, and its sentences: the string literals that hold a space. One without
 * a space is a name, a key or a scope such as "thread_send:remote".
 */
function read(source: string): { code: string; sentences: string[] } {
  const code = transpiler.transformSync(source)
  return { code, sentences: code.match(LITERAL)?.filter((literal) => literal.includes(" ")) ?? [] }
}

function hintProblems(sentences: readonly string[]): string[] {
  const problems: string[] = []
  for (const sentence of sentences) {
    for (const [name] of sentence.matchAll(BARE_TOOL)) if (name in SCHEMAS) problems.push(`bare ${name}`)
    for (const [, name = "", args] of sentence.matchAll(EVAL_FORM)) {
      const schema = SCHEMAS[name]
      if (schema === undefined) problems.push(`no tool.${name}`)
      else
        for (const arg of args?.split(",") ?? []) {
          const key = arg.split(":")[0]?.trim() ?? ""
          if (key !== "" && !(key in schema.properties)) problems.push(`tool.${name} takes no ${key}`)
        }
    }
  }
  return problems
}

const problemsOf = (lines: readonly string[]) => hintProblems(read(lines.join("\n")).sentences)

describe("model-facing thread text names the eval cell", () => {
  test("#given sentences that name a thread tool without tool. #when scanned #then each one is reported", () => {
    const problems = problemsOf([
      'export const a = "Read thread_outbox again and ack a cursor it returned."',
      'export const b = "Run tool.thread_bindings in an eval cell or thread_outbox to see the state."',
      "// a comment's lone quote must not hide the next line",
      "export const c = `Report through a binding of ${session}; thread_bindings lists them.`",
      `export const d = 'Retry with mode set to "tail", then thread_rebind it.'`,
    ])

    expect(problems).toEqual(["bare thread_outbox", "bare thread_outbox", "bare thread_bindings", "bare thread_rebind"])
  })

  test("#given names, scopes, comments, types and eval forms #when scanned #then nothing is reported", () => {
    const problems = problemsOf([
      "// thread_read answers what thread_send delivered",
      'export const name = "thread_send"',
      'export const scope = "thread_send:remote"',
      'export type Name = "thread_read" | "thread_list"',
      'export const hint = "Run tool.thread_list in an eval cell and pass its thread_id."',
      'export const call = "Ask with tool.thread_send({ thread: <id>, message }) in an eval cell."',
    ])

    expect(problems).toEqual([])
  })

  test("#given an eval form of a missing tool or with an argument the tool does not take #when scanned #then it is reported", () => {
    const problems = problemsOf([
      'export const a = "Ask with tool.thread_send({ to, message }) in an eval cell."',
      'export const b = "Run tool.thread_lists in an eval cell."',
    ])

    expect(problems).toEqual(["tool.thread_send takes no to", "no tool.thread_lists"])
  })

  test("#given every thread source file #when its sentences are scanned #then each thread tool is named as a tool.thread_* form the tool accepts", () => {
    const files = [...new Bun.Glob("**/*.ts").scanSync(import.meta.dir)]
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => !NOT_SCANNED.test(file))
      .sort()
    const problems: string[] = []
    const unread: string[] = []
    for (const file of files) {
      const { code, sentences } = read(readFileSync(join(import.meta.dir, file), "utf8"))
      problems.push(...hintProblems(sentences).map((problem) => `${file}: ${problem}`))
      // Every eval form sits in a sentence the scan read, so no hint hides where the literals were mispaired.
      const evalForms = (text: string) => text.match(/tool\.thread_/g)?.length ?? 0
      if (evalForms(sentences.join("\n")) !== evalForms(code)) unread.push(file)
    }

    expect(files).toEqual(expect.arrayContaining(["gateway/relay.ts", "metadata.ts", "tools.ts"]))
    expect(problems).toEqual([])
    expect(unread).toEqual([])
  })
})
