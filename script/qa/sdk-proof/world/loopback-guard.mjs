// Preloaded into every process of the X1a proof world (NODE_OPTIONS --import for node, BUN_OPTIONS --preload for bun):
// fail closed on the network. A request to anything but the loopback address is refused before it leaves and recorded in
// X1A_REFUSED_FILE, which the run requires to stay empty; each process that loaded the guard notes itself in
// X1A_GUARD_LOG, so the run reports which processes it covered instead of assuming it covered them all.
import { appendFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const refusedFile = process.env.X1A_REFUSED_FILE
const guardLog = process.env.X1A_GUARD_LOG
if (guardLog) appendFileSync(guardLog, `${process.pid} ${process.argv.slice(1, 3).join(" ")}\n`)

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])
const refuse = (target) => {
  if (refusedFile) appendFileSync(refusedFile, `${process.pid} ${target}\n`)
  throw new Error(`x1a world: only the loopback address is reachable (${target})`)
}

const realFetch = globalThis.fetch
if (typeof realFetch === "function") {
  globalThis.fetch = Object.assign(async (input, init) => {
    const url = new URL(typeof input === "object" && input !== null && "url" in input ? input.url : String(input))
    if ((url.protocol === "http:" || url.protocol === "https:") && !LOOPBACK.has(url.hostname))
      refuse(`${url.protocol}//${url.host}`)
    return realFetch(input, init)
  }, realFetch)
}

for (const name of ["node:http", "node:https"]) {
  const client = require(name)
  for (const method of ["request", "get"]) {
    const real = client[method]
    client[method] = (...args) => {
      const [first] = args
      if (typeof first === "string" || first instanceof URL) {
        const url = new URL(String(first))
        if (!LOOPBACK.has(url.hostname)) refuse(`${url.protocol}//${url.host}`)
      } else if (first !== null && typeof first === "object" && first.socketPath === undefined) {
        const host = String(first.hostname ?? first.host ?? "localhost").replace(/:\d+$/, "")
        if (!LOOPBACK.has(host)) refuse(`${name} ${host}`)
      }
      return real.apply(client, args)
    }
  }
}

const net = require("node:net")
for (const method of ["connect", "createConnection"]) {
  const real = net[method]
  net[method] = (...args) => {
    const [first, second] = args
    const host =
      typeof first === "number"
        ? typeof second === "string"
          ? second
          : "localhost"
        : first !== null && typeof first === "object" && first.path === undefined && first.port !== undefined
          ? String(first.host ?? "localhost")
          : undefined
    if (host !== undefined && !LOOPBACK.has(host)) refuse(`tcp ${host}`)
    return real.apply(net, args)
  }
}
