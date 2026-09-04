const fs = require("fs")
const dirs = fs.readdirSync(".").filter((d) => /^\.build-(check|extension-test)-/.test(d))
const body = (t) => t.slice(t.indexOf("\n", t.indexOf("// omo:")) + 1)
const mk = (t) => (t.match(/\/\/ omo:[^\n]*/) || ["?"])[0]
const files = []
for (const d of dirs) for (const name of ["omo-task.js", "omo.js"]) { const p = d + "/" + name; if (fs.existsSync(p)) { const t = fs.readFileSync(p, "utf8"); files.push({ d, name, t }) } }
for (const f of files) console.log(f.d.padEnd(34), f.name.padEnd(12), mk(f.t).slice(0, 70), body(f.t).length)
for (const name of ["omo-task.js", "omo.js"]) {
  const byBody = new Map()
  for (const f of files.filter((x) => x.name === name)) { const k = body(f.t); byBody.set(k, (byBody.get(k) || []).concat(f.d)) }
  console.log("distinct " + name + " bodies:", byBody.size, JSON.stringify([...byBody.values()]))
  const vs = [...byBody.keys()]
  if (vs.length >= 2) {
    const a = vs[0].split(";"), b = vs[1].split(";"); let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++
    console.log("firstDivergent", i, "/", a.length, b.length); console.log("A:", (a[i] || "").slice(0, 800)); console.log("B:", (b[i] || "").slice(0, 800))
    const imp = (t) => new Set([...t.matchAll(/from"([^"]+)"|import\("([^"]+)"\)|require\("([^"]+)"\)/g)].map((m) => m[1] || m[2] || m[3]))
    const ia = imp(vs[0]), ib = imp(vs[1])
    console.log("specifiers only in A:", [...ia].filter((x) => !ib.has(x)).join(",")); console.log("specifiers only in B:", [...ib].filter((x) => !ia.has(x)).join(","))
  }
}
