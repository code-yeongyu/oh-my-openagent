import { describe, expect, test } from "bun:test"
import { findRawTlsClients } from "./no-raw-tls-client-scan"

// Security contract (#15071): when one variable receives two tracked values, the alias pass keeps the value bound
// first in source order. A program that really calls that first client (the language is the oracle: each program runs
// against fake modules that record client calls) must be reported, whatever shape the second binding takes.

const VALUES = { bun: "globalThis.Bun", https: 'require("node:https")', tls: 'require("node:tls")', safe: "safe" }
type Value = keyof typeof VALUES
const CALL: Record<Value, string> = {
  bun: "a.connect(o)",
  https: "a.request(o)",
  tls: "a.connect(o)",
  safe: "a.connect(o)",
}
const SHAPES: Record<string, (first: string, second: string) => string> = {
  "declaration then assignment": (first, second) => `let a = ${first}; a = ${second};`,
  "assignment then assignment": (first, second) => `let a; a = ${first}; a = ${second};`,
  "assignment in a branch": (first, second) => `let a = ${first}; if (c) a = ${second};`,
  "assignment in a loop": (first, second) => `let a = ${first}; for (let i = 0; i < 1; i++) a = ${second};`,
  "assignment in a skipped branch": (first, second) => `let a = ${first}; if (!c) a = ${second};`,
}
const ALIAS_DEPTH = ["", "let p = a; a = p;", "let p = a; let q = p; a = q;"]
const names = Object.keys(VALUES) as Value[]

const programs = names.flatMap((first) =>
  names
    .filter((second) => second !== first)
    .flatMap((second) =>
      Object.entries(SHAPES).flatMap(([shape, make]) =>
        ALIAS_DEPTH.map((alias, depth) => ({
          label: `${first} then ${second}, ${shape}, alias depth ${depth}`,
          source: `${make(VALUES[first], VALUES[second])} ${alias} ${CALL[first]};`,
        })),
      ),
    ),
)

function callsAtRuntime(source: string): boolean {
  let calls = 0
  const record = (): number => (calls += 1)
  const modules: Record<string, unknown> = { "node:https": { request: record }, "node:tls": { connect: record } }
  const run = new Function("globalThis", "safe", "o", "c", "require", source)
  try {
    run({ Bun: { connect: record } }, { connect: () => undefined }, {}, true, (name: string) => modules[name])
  } catch {}
  return calls > 0
}

const isClientCall = (id: string): boolean =>
  !/^(require\(|import|module access|template |getBuiltinModule|re-export)/.test(id)

// Fixed cases from the security review: the full hit list of the reviewed scanner at e8fd78cfdd, in its order.
const REVIEWED: Record<string, { source: string; expected: string[] }> = {
  O1: {
    source: 'let a = Bun; if (c) a = require("node:https"); a.connect({ hostname: "h", port: 1, tls: true });',
    expected: ["Bun.connect(", 'require("node:https")'],
  },
  O2: {
    source: 'let a = require("node:https"); if (c) a = Bun; a.connect({ hostname: "h", port: 1, tls: true });',
    expected: ['require("node:https")'],
  },
  O3: { source: 'let a = Bun; if (c) a = require("node:https"); a.request(o);', expected: ['require("node:https")'] },
  O4: {
    source: 'let a = require("node:https"); if (c) a = Bun; a.request(o);',
    expected: ["https.request(", 'require("node:https")'],
  },
  O5: {
    source: 'let a = require("node:tls"); if (c) a = require("node:http2"); a.connect(o);',
    expected: ['require("node:http2")', 'require("node:tls")', "tls.connect("],
  },
  O6: {
    source: "let c = Bun.connect; if (x) c = other; c(o);",
    expected: ['binding call: c (imported from "undefined")', "Bun.connect reference"],
  },
  O7: {
    source: "let c = other; if (x) c = Bun.connect; c(o);",
    expected: ['binding call: c (imported from "undefined")', "Bun.connect reference"],
  },
  O8: {
    source: 'let a; a = require("node:tls"); if (c) a = require("node:https"); a.connect(o);',
    expected: ['require("node:https")', 'require("node:tls")', "tls.connect("],
  },
  O9: {
    source: 'let a; a = require("node:https"); if (c) a = require("node:tls"); a.connect(o);',
    expected: ['require("node:https")', 'require("node:tls")'],
  },
  O10: {
    source: '(function (a = Bun) { a.connect({ tls: true }) })(require("node:https"));',
    expected: ['require("node:https")'],
  },
  O11: {
    source: '(function (a = require("node:https")) { a.connect({ tls: true }) })(Bun);',
    expected: ["Bun.connect(", 'require("node:https")'],
  },
  O12: {
    source: 'let a = Bun; let b = a; a = require("node:https"); b.connect({ tls: true });',
    expected: ["Bun.connect(", 'require("node:https")'],
  },
  O13: { source: "let a; a = Bun; const b = a; b.connect({ tls: true });", expected: ["Bun.connect("] },
  O14: {
    source: 'let a = require("node:https"); a = require("node:tls"); const { connect } = a; connect(o);',
    expected: ['require("node:https")', 'require("node:tls")'],
  },
  O15: {
    source: 'let a = require("node:https"); a = Bun; const { connect } = a; connect({ tls: true });',
    expected: ['require("node:https")'],
  },
  O16: {
    source: 'for (const m of [require("node:https"), require("node:tls")]) m.connect(o);',
    expected: ['require("node:https")', 'require("node:tls")'],
  },
  O17: {
    source: 'for (const m of [require("node:tls"), require("node:https")]) m.connect(o);',
    expected: ['require("node:https")', 'require("node:tls")', "tls.connect("],
  },
  O18: {
    source: 'let g = globalThis; let t = g.Bun; t = require("node:https"); t.connect({ tls: true });',
    expected: ["Bun.connect(", 'require("node:https")'],
  },
  O19: { source: "let a; let b = a; a = Bun; b = a; b.connect({ tls: true });", expected: ["Bun.connect("] },
  O20: {
    source: 'let a = (b = Bun, require("node:https")); var b; b.connect({ tls: true }); a.request(o);',
    expected: ["Bun.connect(", 'require("node:https")'],
  },
}

describe("a variable that receives two tracked values (#15071)", () => {
  test("every program that calls the first client a variable received is reported", () => {
    const calling = programs.filter(({ source }) => callsAtRuntime(source))
    const missed = calling.filter(
      ({ source }) => !findRawTlsClients(source, "x.js").some((hit) => isClientCall(hit.id)),
    )
    expect(calling.length).toBe(75)
    expect(missed.map(({ label }) => label)).toEqual([])
  })

  test.each(Object.entries(REVIEWED))("%s gives the reviewed scanner's full hit list", (_id, { source, expected }) => {
    expect(findRawTlsClients(source, "x.js").map((hit) => hit.id)).toEqual(expected)
  })
})
