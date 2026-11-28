import { describe, expect, test } from "bun:test"
import ts from "@typescript/typescript6"
import { AMBIENT, BINDING_KINDS, NEVER_SHADOWS } from "./no-raw-tls-client-bindings"
import { RUNTIME_GLOBALS } from "./no-raw-tls-client"
import { findRawTlsClients } from "./no-raw-tls-client-scan"

// Security contract (#15071): every declaration kind is classified, and no classification hides a client call that
// really runs. The universe is defined by the compiler, not by this file: every SyntaxKind for which `ts.isDeclaration`
// holds in TypeScript 6.0 (@typescript/typescript6). A compiler upgrade that adds a declaration kind fails the totality
// test until the kind is classified. The oracle is generated from the table: every row and condition branch has forms,
// each form is transpiled by Bun's transpiler, by tsc one file at a time, and by a whole tsc program (which erases const
// enums), all to CommonJS where tsc is used, and run against a fake runtime that records every
// connect call, as a module for .mts/.cts and for a file with imports or exports, as a classic script otherwise. If
// either transpiled program reaches the client, the scanner must report it. A declaration file is never
// executed, so there a report is required unconditionally.

const PINNED_TYPESCRIPT = "6.0."

// The compiler exports isDeclaration at runtime but leaves it out of its public typings.
const isDeclaration: unknown = Reflect.get(ts, "isDeclaration")

function declarationKinds(): ts.SyntaxKind[] {
  if (typeof isDeclaration !== "function") throw new Error("ts.isDeclaration is gone: re-derive the universe")
  const kinds = new Set<ts.SyntaxKind>()
  for (const value of Object.values(ts.SyntaxKind)) {
    if (typeof value !== "number") continue
    const probe = { kind: value, flags: 0, parent: { kind: ts.SyntaxKind.FunctionDeclaration } }
    if (isDeclaration(probe) === true) kinds.add(value)
  }
  return [...kinds]
}

type Placement = "module before" | "module after" | "function body" | "block"
type Form = { readonly at: readonly Placement[]; readonly declare: (n: string) => string }
type Program = { readonly program: (n: string, call: string) => string }
const ALL: readonly Placement[] = ["module before", "module after", "function body", "block"]
const MODULE: readonly Placement[] = ["module before", "module after"]
const stmts = (at: readonly Placement[], ...declares: ((n: string) => string)[]): Form[] =>
  declares.map((declare) => ({ at, declare }))
// The module behind "./t" in the whole-program emit: its exports named like a runtime global are types only.
// Generated from the receivers below, not from the scanner's set, so removing a name from the set cannot remove its
// own check; the receiver control keeps every runtime global in that list.
const TYPES_ONLY_MODULE = () =>
  [
    ...RECEIVERS.map((receiver) => `export type ${receiver.binding} = { x: number }`),
    "export type Other = number",
    "export default interface D { x: number }",
  ].join("\n")
const GLOBALS_DECLARATION = () =>
  [
    ...RECEIVERS.filter((receiver) => receiver.setup === "").map((receiver) => `declare var ${receiver.binding}: any`),
    "declare var o: any",
  ].join("\n")
const NS = "namespace NS { export type T = number; export const v = { connect() {} } }"

const FORMS: Record<string, readonly (Form | Program)[]> = {
  "VariableDeclaration: value": [
    ...stmts(
      ALL,
      (n) => `const ${n} = { connect() {} };`,
      (n) => `let ${n} = { connect() {} };`,
    ),
    ...stmts(["function body", "block"], (n) => `var ${n} = { connect() {} };`),
    ...stmts(MODULE, (n) => `export {}; var ${n} = { connect() {} };`),
  ],
  "VariableDeclaration: top-level var in a script": stmts(MODULE, (n) => `var ${n} = { connect() {} };`),
  "VariableDeclaration: catch binding": [
    { program: (n, call) => `try { throw { connect() {} } } catch (${n}) { ${call} }` },
  ],
  [`VariableDeclaration: ${AMBIENT}`]: [
    ...stmts(
      ALL,
      (n) => `declare const ${n}: any;`,
      (n) => `declare let ${n}: any;`,
      (n) => `declare var ${n}: any;`,
    ),
    ...stmts(
      ALL,
      (n) => `declare const { ${n} }: any;`,
      (n) => `declare const [${n}]: any;`,
    ),
    ...stmts(
      MODULE,
      (n) => `export declare const ${n}: any;`,
      (n) => `declare global { var ${n}: any }`,
    ),
  ],
  "Parameter: value": [
    { program: (n, call) => `function f(${n}) { ${call} } f({ connect() {} })` },
    { program: (n, call) => `((${n}) => { ${call} })({ connect() {} })` },
  ],
  "Parameter: function reads arguments": [
    { program: (n, call) => `function f(${n}) { arguments[0] = globalThis.Bun; ${call} } f({ connect() {} })` },
  ],
  "Parameter: signature only": [{ program: (n, call) => `function f(${n}): void;\n${call}` }],
  [`Parameter: ${AMBIENT}`]: [{ program: (n, call) => `declare function f(${n}: any): void;\n${call}` }],
  "FunctionExpression: value": [{ program: (n, call) => `(function ${n}() { ${call} })()` }],
  "ClassExpression: value": [{ program: (n, call) => `(class ${n} { static { ${call} } })` }],
  "FunctionDeclaration: value": stmts(ALL, (n) => `function ${n}() {}`),
  "FunctionDeclaration: signature only": [
    ...stmts(
      ALL,
      (n) => `function ${n}(): void;`,
      (n) => `async function ${n}(): Promise<void>;`,
    ),
    ...stmts(
      MODULE,
      (n) => `export function ${n}(): void;`,
      (n) => `export default function ${n}(): void;`,
    ),
  ],
  "FunctionDeclaration: signature with implementation": stmts(ALL, (n) => `function ${n}(): void; function ${n}() {}`),
  [`FunctionDeclaration: ${AMBIENT}`]: [
    ...stmts(ALL, (n) => `declare function ${n}(): void;`),
    ...stmts(MODULE, (n) => `export declare function ${n}(): void;`),
  ],
  "ClassDeclaration: value": stmts(ALL, (n) => `class ${n} {}`),
  [`ClassDeclaration: ${AMBIENT}`]: [
    ...stmts(
      ALL,
      (n) => `declare class ${n} {}`,
      (n) => `declare abstract class ${n} {}`,
    ),
    ...stmts(MODULE, (n) => `export declare class ${n} {}`),
  ],
  "EnumDeclaration: value": [
    ...stmts(["function body", "block"], (n) => `enum ${n} { A }`),
    ...stmts(MODULE, (n) => `export {}; enum ${n} { A }`),
  ],
  "EnumDeclaration: top-level in a script": stmts(MODULE, (n) => `enum ${n} { A }`),
  "EnumDeclaration: const": stmts(ALL, (n) => `const enum ${n} { A }`),
  [`EnumDeclaration: ${AMBIENT}`]: stmts(
    ALL,
    (n) => `declare enum ${n} { A }`,
    (n) => `declare const enum ${n} { A }`,
  ),
  "ImportEqualsDeclaration: require": stmts(MODULE, (n) => `import ${n} = require("m");`),
  "ImportEqualsDeclaration: entity name": [
    ...stmts(
      MODULE,
      (n) => `${NS} import ${n} = NS.T;`,
      (n) => `${NS} import ${n} = NS.v;`,
    ),
    ...stmts(MODULE, (n) => `${NS} export import ${n} = NS.T;`),
    { program: (n, call) => `${NS}\nnamespace N { import ${n} = NS.T; ${call} }` },
  ],
  "ImportEqualsDeclaration: type-only": stmts(MODULE, (n) => `import type ${n} = require("m");`),
  "ImportClause: value": stmts(MODULE, (n) => `import ${n} from "m";`),
  "ImportClause: type-only": stmts(MODULE, (n) => `import type ${n} from "m";`),
  "ImportClause: a runtime global's name": stmts(MODULE, (n) => `import ${n} from "./t";`),
  "NamespaceImport: value": stmts(MODULE, (n) => `import * as ${n} from "m";`),
  "NamespaceImport: type-only": stmts(MODULE, (n) => `import type * as ${n} from "m";`),
  "ImportSpecifier: value": stmts(
    MODULE,
    (n) => `import { x as ${n} } from "m";`,
    (n) => `import { ${n} } from "m";`,
  ),
  "ImportSpecifier: type-only import": stmts(
    MODULE,
    (n) => `import type { x as ${n} } from "m";`,
    (n) => `import type { ${n} } from "m";`,
  ),
  "ImportSpecifier: type-only specifier": stmts(
    MODULE,
    (n) => `import { type x as ${n} } from "m";`,
    (n) => `import { type ${n} } from "m";`,
    (n) => `import { type x as ${n}, y } from "m";`,
  ),
  "ImportSpecifier: a runtime global's name": stmts(
    MODULE,
    (n) => `import { ${n} } from "./t";`,
    (n) => `import { Other as ${n} } from "./t";`,
  ),
}

const RECEIVERS = [
  { binding: "Bun", setup: "", call: "Bun.connect(o);" },
  { binding: "t", setup: "var t = globalThis.Bun;", call: "t.connect(o);" },
  { binding: "globalThis", setup: "", call: "globalThis.Bun.connect(o);" },
  { binding: "global", setup: "", call: "global.Bun.connect(o);" },
  { binding: "self", setup: "", call: "self.Bun.connect(o);" },
] as const

function programs(form: Form | Program, receiver: (typeof RECEIVERS)[number]): string[] {
  const { binding: n, setup, call } = receiver
  if ("program" in form) return [`${setup}\n${form.program(n, call)}`]
  return form.at.map((placement) => {
    const d = form.declare(n)
    if (placement === "module before") return `${setup}\n${d}\n${call}`
    if (placement === "module after") return `${setup}\n${call}\n${d}`
    if (placement === "function body") return `${setup}\nfunction g() {\n${d}\n${call}\n}\ntry { g() } catch {}`
    return `${setup}\n{\n${d}\n${call}\n}`
  })
}

const safe: unknown = new Proxy(() => undefined, { get: (_target, key) => (key === "__esModule" ? undefined : safe) })

// A module runs in its own scope, so its top-level declarations are local; a classic script's top level is the global.
function reaches(js: string, module: boolean): boolean | undefined {
  let calls = 0
  const client = { connect: () => (calls += 1) }
  let run: (...args: unknown[]) => void
  try {
    const body = module ? `(function () {\n${js}\n})()` : js
    run = new Function("globalThis", "global", "self", "Bun", "o", "require", "exports", "module", body) as typeof run
  } catch {
    return undefined
  }
  try {
    const globalObject = { Bun: client }
    run(globalObject, globalObject, globalObject, client, {}, () => safe, {}, { exports: {} })
  } catch {}
  return calls > 0
}

const bunTranspiler = new Bun.Transpiler({ loader: "ts" })
const TRANSPILERS = {
  bun: (source: string, module: boolean): boolean | undefined => {
    let out: string
    try {
      out = bunTranspiler.transformSync(source)
    } catch {
      return undefined
    }
    if (/^\s*import\b/m.test(out)) return false
    return reaches(out.replace(/^(\s*)export (default )?/gm, "$1"), module)
  },
  "tsc program": (source: string, module: boolean): boolean | undefined => {
    let out = ""
    const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, noLib: true, types: [] }
    const host = ts.createCompilerHost(options)
    const files = new Map([
      ["x.ts", source],
      ["t.ts", TYPES_ONLY_MODULE()],
      ["globals.d.ts", GLOBALS_DECLARATION()],
    ])
    const local = (name: string) => name.replace(/^\/+/, "")
    host.getSourceFile = (name, version) => {
      const text = files.get(local(name))
      return text === undefined ? undefined : ts.createSourceFile(local(name), text, version)
    }
    host.getCurrentDirectory = () => "/"
    host.fileExists = (name) => files.has(local(name))
    host.readFile = (name) => files.get(local(name))
    host.writeFile = (name, text) => {
      if (local(name) === "x.js") out = text
    }
    ts.createProgram(["x.ts", "globals.d.ts"], options, host).emit()
    return reaches(out, module)
  },
  tsc: (source: string, module: boolean): boolean | undefined => {
    const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    return reaches(ts.transpileModule(source, { compilerOptions: options, fileName: "x.ts" }).outputText, module)
  },
}

describe("declaration kinds and the runtime bindings they create (#15071)", () => {
  test("every declaration kind the compiler knows is classified exactly once, with a reason", () => {
    expect(ts.version.startsWith(PINNED_TYPESCRIPT)).toBe(true)
    const universe = declarationKinds()
    const unclassified = universe.filter((kind) => BINDING_KINDS.has(kind) === NEVER_SHADOWS.has(kind))
    const outside = [...BINDING_KINDS.keys(), ...NEVER_SHADOWS.keys()].filter((kind) => !universe.includes(kind))
    expect(unclassified.map((kind) => ts.SyntaxKind[kind])).toEqual([])
    expect(outside.map((kind) => ts.SyntaxKind[kind])).toEqual([])
    for (const reason of NEVER_SHADOWS.values()) expect(reason.length).toBeGreaterThan(0)
  })

  test("every runtime global the scanner knows has a receiver in the generated programs", () => {
    const receivers = new Set<string>(RECEIVERS.map((receiver) => receiver.binding))
    expect([...RUNTIME_GLOBALS].filter((name) => !receivers.has(name))).toEqual([])
  })

  test("every row and condition branch of the table has generated forms", () => {
    const branches = [...BINDING_KINDS].flatMap(([kind, rule]) =>
      rule.branches.map((b) => `${ts.SyntaxKind[kind]}: ${b}`),
    )
    expect(Object.keys(FORMS).sort()).toEqual(branches.sort())
  })

  // One case per branch keeps each case well inside the default limit on a loaded host.
  test.each(Object.entries(FORMS))("%s: no call that runs goes unreported", (branch, forms) => {
    let judged = 0
    const missed: string[] = []
    for (const source of forms.flatMap((form) => RECEIVERS.flatMap((receiver) => programs(form, receiver)))) {
      const isModule = ts.isExternalModule(ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest))
      const run = (module: boolean) => Object.values(TRANSPILERS).map((transpile) => transpile(source, module))
      const asModule = run(true)
      const asWritten = isModule ? asModule : run(false)
      if ([...asModule, ...asWritten].some((result) => result !== undefined)) judged += 1
      const files = [
        ...(asWritten.includes(true) ? ["x.ts"] : []),
        ...(asModule.includes(true) ? ["x.mts", "x.cts"] : []),
      ]
      for (const file of [...files, "x.d.ts", "x.d.mts", "x.d.cts"])
        if (findRawTlsClients(source, file).length === 0) missed.push(`${branch} in ${file}:\n${source}`)
    }
    expect(judged).toBeGreaterThan(0)
    expect(missed).toEqual([])
  })
})
