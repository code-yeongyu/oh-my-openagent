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
      "module alias shadowed by a function var",
      "var t = globalThis.Bun; function f() { var t = o; return t.connect() }",
    ],
    [
      "a minified injection seam with a local-socket default",
      'function a(){let t=globalThis.Bun;return t.hash(x)}function b(t){let e=t.connect??(n=>require("node:net").createConnection(n));return e(p)}',
    ],
  ])("%s: no hit", (_name, sample) => {
    expect(connectHits(sample)).toBe(0)
  })

  test.each([
    ["scope form 1", "var t = globalThis.Bun; t.connect"],
    ["scope form 2", "var t = globalThis.Bun; function f() { return t.connect }"],
    ["scope form 3", "function f() { { var t = globalThis.Bun } return t.connect() }"],
    ["scope form 4", "var t = globalThis.Bun; { let t = o } t.connect()"],
    ["scope form 5", "const b = globalThis.Bun; function f() { const c = b; return c.connect() }"],
    ["scope form 6", "var t = globalThis.Bun; function f(t) { with (o) { return t.connect } }"],
    ["scope form 7", 'var t = globalThis.Bun; function f(t) { eval("x"); return t.connect }'],
    ["scope form 8", 'var t = globalThis.Bun; function f(t) { (eval)("x"); return t.connect }'],
    ["scope form 9", "var t = globalThis.Bun; { var t; t.connect(o) }"],
    ["scope form 10", "var t = globalThis.Bun; if (x) { var t; t.connect(o) }"],
    ["scope form 11", "var t = globalThis.Bun; for (var t; ;) { t.connect(o); break }"],
    ["scope form 12", "var t = globalThis.Bun; try { run() } catch (e) { var t; t.connect(o) }"],
    ["scope form 13", "function f(){ { var t = globalThis.Bun } { var t; return t.connect(o) } }"],
    ["scope form 14", "function f(){ var t; if (x) { var t = globalThis.Bun } return t.connect(o) }"],
    ["scope form 15", "function f(){ var t = o; { var t = globalThis.Bun } { return t.connect(o) } }"],
    ["scope form 16", "var t = globalThis.Bun; var t; t.connect(o)"],
    ["scope form 17", "var t; if (x) { var t = globalThis.Bun } t.connect(o)"],
    ["scope form 18", "var t = globalThis.Bun; globalThis.t.connect(o)"],
    ["scope form 19", "var t = globalThis.Bun; class C { [t.connect(o)](t) {} }"],
    ["scope form 20", "var t = globalThis.Bun; function f(t) { arguments[0] = globalThis.Bun; return t.connect(o) }"],
    ["scope form 21", "function f(t = globalThis.Bun) { return t.connect(o) }"],
    [
      "scope form 22",
      "function a(){ let t = globalThis.Bun; return t.version } function f(t = globalThis.Bun) { return t.connect(o) }",
    ],
    ["scope form 23", "function f() { let t; t = globalThis.Bun; return t.connect(o) }"],
    ["scope form 24", "var t = globalThis.Bun; function f() { let t; t = globalThis.Bun; return t.connect(o) }"],
    ["scope form 25", "var t = globalThis.Bun; (function (t) { return t.connect(o) })(t)"],
    ["scope form 26", "var t = globalThis.Bun; ((t) => t.connect(o))(t)"],
    ["scope form 27", "var t = globalThis.Bun; function f(t) { return t.connect } function g() { return t.connect }"],
  ])("%s: still a hit", (_name, sample) => {
    expect(connectHits(sample)).toBeGreaterThanOrEqual(1)
  })

  test.each([
    "function f({ connect: n } = Bun) { return n(o) }",
    "var b = globalThis.Bun; function f({ connect: n } = b) { return n(o) }",
    "const f = ({ connect } = globalThis.Bun) => connect(o)",
    'import tls from "node:tls"; function f({ connect: c } = tls) { return c(o) }',
  ])("binding form in a parameter list is reported: %s", (sample) => {
    const hits = findRawTlsClients(sample)
    expect(
      hits.some((hit) => hit.id.endsWith("destructuring") || hit.id.startsWith("binding call")),
      sample,
    ).toBe(true)
  })

  test("a connect member read on a local options object is classified by scope, not by its short name", () => {
    const runtimeAlias = "function r(){ let e = globalThis.Bun; return e.version }"
    const optionsRead = "function w(e){ let n = e.connect ?? (t => net.createConnection(t)); return n(p) }"
    const runtimeRead = "function w(){ let e = globalThis.Bun; let n = e.connect; return n(p) }"
    expect(findRawTlsClients(runtimeAlias + optionsRead)).toEqual([])
    expect(connectHits(runtimeAlias + runtimeRead)).toBe(1)
  })

  test("a sibling shadow does not hide, and does not duplicate, the real reference", () => {
    expect(
      connectHits("var t = globalThis.Bun; function f(t) { return t.connect } function g() { return t.connect }"),
    ).toBe(1)
  })

  test.each([
    'import tls from "node:tls"; function f(){ var x; { var x = tls } return x.connect(o) }',
    'function f(){ { var x = require("node:tls") } { var x; return x.connect(o) } }',
  ])("a tls alias split across one function's var declarations keeps its connect hit: %s", (sample) => {
    expect(findRawTlsClients(sample).some((hit) => hit.text === "x.connect(o)")).toBe(true)
  })
})
