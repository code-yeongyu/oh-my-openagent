import { describe, expect, test } from "bun:test"
import { findRawTlsClients } from "./no-raw-tls-client-scan"

// Security contract (#15071): a declaration that creates no runtime value never hides a client. Twin check: adding such a
// declaration to a program that is reported never changes its report, for every way of reaching a client and every
// TypeScript file kind. The transpile-and-run oracle over every declaration kind is no-raw-tls-client-bindings.test.ts.

type Placement = "module" | "body" | "nested block"
type TypeForm = { readonly name: string; readonly at: readonly Placement[]; readonly declare: (name: string) => string }

const TYPE_FORMS: readonly TypeForm[] = [
  { name: "declare const", at: ["module", "body", "nested block"], declare: (n) => `declare const ${n}: any;` },
  { name: "declare let", at: ["module", "body", "nested block"], declare: (n) => `declare let ${n}: any;` },
  { name: "declare var", at: ["module", "body", "nested block"], declare: (n) => `declare var ${n}: any;` },
  { name: "declare function", at: ["module", "body"], declare: (n) => `declare function ${n}(): void;` },
  { name: "declare class", at: ["module", "body"], declare: (n) => `declare class ${n} {}` },
  { name: "declare abstract class", at: ["module", "body"], declare: (n) => `declare abstract class ${n} {}` },
  { name: "declare const destructured", at: ["module", "body"], declare: (n) => `declare const { ${n} }: any;` },
  { name: "declare const array destructured", at: ["module", "body"], declare: (n) => `declare const [${n}]: any;` },
  { name: "export declare const", at: ["module"], declare: (n) => `export declare const ${n}: any;` },
  { name: "export declare function", at: ["module"], declare: (n) => `export declare function ${n}(): void;` },
  { name: "export declare class", at: ["module"], declare: (n) => `export declare class ${n} {}` },
  { name: "declare const enum", at: ["module"], declare: (n) => `declare const enum ${n} { A }` },
  { name: "declare enum", at: ["module"], declare: (n) => `declare enum ${n} { A }` },
  { name: "declare namespace", at: ["module"], declare: (n) => `declare namespace ${n} { const x: number }` },
  { name: "declare global", at: ["module"], declare: (n) => `declare global { var ${n}: any }` },
  { name: "interface", at: ["module", "body", "nested block"], declare: (n) => `interface ${n} { x: number }` },
  { name: "type alias", at: ["module", "body", "nested block"], declare: (n) => `type ${n} = { x: number };` },
  { name: "import type default", at: ["module"], declare: (n) => `import type ${n} from "m";` },
  { name: "import type named", at: ["module"], declare: (n) => `import type { x as ${n} } from "m";` },
  { name: "import type namespace", at: ["module"], declare: (n) => `import type * as ${n} from "m";` },
  { name: "inline type specifier", at: ["module"], declare: (n) => `import { type x as ${n} } from "m";` },
  { name: "inline type named", at: ["module"], declare: (n) => `import { type ${n} } from "m";` },
  { name: "import type named unrenamed", at: ["module"], declare: (n) => `import type { ${n} } from "m";` },
  { name: "import type equals", at: ["module"], declare: (n) => `import type ${n} = require("m");` },
]

const FILE_KINDS = ["x.ts", "x.mts", "x.cts", "x.d.ts"] as const

const RECEIVERS = [
  { name: "the Bun global", binding: "Bun", setup: "", call: "Bun.connect(o);" },
  { name: "an alias", binding: "t", setup: "var t = globalThis.Bun;", call: "t.connect(o);" },
  { name: "the global object", binding: "globalThis", setup: "", call: "globalThis.Bun.connect(o);" },
  { name: "a tls module", binding: "tls", setup: 'import tls from "node:tls";', call: "tls.connect(o);" },
  { name: "a tls namespace", binding: "tls", setup: 'import * as tls from "node:tls";', call: "tls.connect(o);" },
  {
    name: "an imported function",
    binding: "connect",
    setup: 'import { connect } from "node:tls";',
    call: "connect(o);",
  },
  { name: "an https module", binding: "https", setup: 'import https from "node:https";', call: "https.request(o);" },
] as const

function twins(form: TypeForm, placement: Placement | "after use", receiver: (typeof RECEIVERS)[number]) {
  const shadow = form.declare(receiver.binding)
  const wrap = (inner: string) => `${receiver.setup}\nfunction f() {\n${inner}\n}\n`
  const body = (withShadow: boolean): string => {
    const s = withShadow ? shadow : ""
    if (placement === "module") return `${s}\n${wrap(receiver.call)}`
    if (placement === "after use") return `${wrap(receiver.call)}\n${s}`
    if (placement === "body") return wrap(`${s}\n${receiver.call}`)
    return wrap(`{ ${s} }\n${receiver.call}`)
  }
  return { plain: body(false), shadowed: body(true) }
}

describe("declarations that create no runtime value never hide a client (#15071)", () => {
  test("adding one to a reported program never changes its report, for every receiver and TypeScript file kind", () => {
    const changed: string[] = []
    let compared = 0
    for (const form of TYPE_FORMS)
      for (const placement of [...form.at, ...(form.at.includes("module") ? (["after use"] as const) : [])])
        for (const receiver of RECEIVERS)
          for (const file of FILE_KINDS) {
            const { plain, shadowed } = twins(form, placement, receiver)
            const expected = findRawTlsClients(plain, file).length
            expect(expected, `${receiver.name} is reported in ${file}`).toBeGreaterThan(0)
            compared += 1
            if (findRawTlsClients(shadowed, file).length !== expected)
              changed.push(`${form.name} at ${placement}, ${receiver.name}, ${file}`)
          }
    expect(compared).toBeGreaterThan(1000)
    expect(changed).toEqual([])
  })
})
