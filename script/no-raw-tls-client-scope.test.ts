import { describe, expect, test } from "bun:test"
import { findRawTlsClients } from "./no-raw-tls-client-scan"

const connectHits = (sample: string): number =>
  findRawTlsClients(sample).filter((hit) => hit.id === "Bun.connect reference" || hit.id === "Bun.connect(").length

// Security contract (#15071): a name bound to Bun is resolved through lexical scope. A parameter or local that
// shadows the name is not the Bun binding, and whatever the scanner cannot resolve stays a hit.
describe("Bun.connect reference rule is scope-aware (#15071)", () => {
  test.each([
    [
      "alias in one function, a parameter of the same name in another",
      "function a() { let t = globalThis.Bun; return t.version } function b(t) { return t.connect ?? fallback }",
    ],
    [
      "alias in one function, a local of the same name in another",
      "function a() { const t = globalThis.Bun; return t.version } function b(o) { const t = o; return t.connect() }",
    ],
    ["module alias shadowed by a parameter", "var t = globalThis.Bun; function f(t) { return t.connect }"],
    ["module alias shadowed by a destructured parameter", "var t = globalThis.Bun; const f = ({ t }) => t.connect"],
    ["module alias shadowed by a catch binding", "var t = globalThis.Bun; try { run() } catch (t) { t.connect() }"],
    ["module alias shadowed by a block let", "var t = globalThis.Bun; { let t = options; t.connect() }"],
    ["the global Bun shadowed by a parameter", "function f(Bun) { return Bun.connect(options) }"],
    [
      "a minified injection seam with a local-socket default",
      'function a(){let t=globalThis.Bun;return t.hash(x)}function b(t){let e=t.connect??(n=>require("node:net").createConnection(n));return e(p)}',
    ],
  ])("%s: no hit", (_name, sample) => {
    expect(connectHits(sample)).toBe(0)
  })

  test.each([
    ["the alias used in its own scope", "var t = globalThis.Bun; t.connect", 1],
    ["an enclosing alias with no shadow", "var t = globalThis.Bun; function f() { return t.connect }", 1],
    ["a var alias hoisted out of its block", "function f() { { var t = globalThis.Bun } return t.connect() }", 1],
    ["a block shadow that does not reach the outer reference", "var t = globalThis.Bun; { let t = o } t.connect()", 1],
    [
      "a sibling shadow next to a real reference",
      "var t = globalThis.Bun; function f(t) { return t.connect } function g() { return t.connect }",
      1,
    ],
    [
      "an alias chain through two scopes",
      "const b = globalThis.Bun; function f() { const c = b; return c.connect() }",
      1,
    ],
    [
      "a with statement keeps the shadowed reference",
      "var t = globalThis.Bun; function f(t) { with (o) { return t.connect } }",
      1,
    ],
    [
      "a direct eval keeps the shadowed reference",
      'var t = globalThis.Bun; function f(t) { eval("x"); return t.connect }',
      1,
    ],
  ])("%s: still a hit", (_name, sample, expected) => {
    expect(connectHits(sample)).toBe(expected)
  })
})
