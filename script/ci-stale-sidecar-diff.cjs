const fs = require("node:fs")
const path = require("node:path")
const dir = process.argv[2]
const c = fs.readFileSync(path.join(dir, "committed-omo-task.js"), "utf8")
const r = fs.readFileSync(path.join(dir, "rebuilt-omo-task.js"), "utf8")
const marker = (t) => (t.match(/\/\/ omo:[^\n]*/) ?? ["?"])[0]
const body = (t) => t.slice(t.indexOf("\n", t.indexOf("// omo:")) + 1)
console.log("PROBE committed:", marker(c)); console.log("PROBE rebuilt:  ", marker(r))
const a = body(c).split(";"), b = body(r).split(";")
let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i += 1
console.log("PROBE bodyLen committed=" + body(c).length + " rebuilt=" + body(r).length + " stmts=" + a.length + "/" + b.length + " firstDivergent=" + i)
for (let k = i; k < Math.min(i + 4, Math.max(a.length, b.length)); k += 1) { console.log("PROBE C" + k + ": " + (a[k] ?? "").slice(0, 700)); console.log("PROBE R" + k + ": " + (b[k] ?? "").slice(0, 700)) }
const specs = (t) => new Set([...t.matchAll(/from"([^"]+)"|import\("([^"]+)"\)|require\("([^"]+)"\)/g)].map((m) => m[1] ?? m[2] ?? m[3]))
const sc = specs(body(c)), sr = specs(body(r))
console.log("PROBE specifiers only in committed:", [...sc].filter((s) => !sr.has(s)).join(",") || "-")
console.log("PROBE specifiers only in rebuilt:  ", [...sr].filter((s) => !sc.has(s)).join(",") || "-")
const ids = (t) => new Set(t.match(/\b__[A-Za-z]+\b/g) ?? [])
const ic = ids(body(c)), ir = ids(body(r))
console.log("PROBE helpers only in committed:", [...ic].filter((s) => !ir.has(s)).join(",") || "-")
console.log("PROBE helpers only in rebuilt:  ", [...ir].filter((s) => !ic.has(s)).join(",") || "-")
// tail comparison: is it an insertion (suffix equal) or a global reorder?
let j = 0; while (j < a.length && j < b.length && a[a.length - 1 - j] === b[b.length - 1 - j]) j += 1
console.log("PROBE common suffix stmts=" + j + " => differing window committed[" + i + ".." + (a.length - j) + ") rebuilt[" + i + ".." + (b.length - j) + ")")
