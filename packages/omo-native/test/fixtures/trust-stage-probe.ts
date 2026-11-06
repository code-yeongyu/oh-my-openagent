import { adoptedEngineTrust } from "@code-yeongyu/senpi/engine-trust"
import { runTrustStage } from "../../trust-stage"
import { get } from "node:https"

// Captured before the trust stage runs, as a module that saves the global reference at load time would.
const savedFetch = fetch
const directory = process.argv[2]
if (directory === undefined) throw new Error("usage: trust-stage-probe <directory> [mode]")
const mode = process.argv[3]
const result = await runTrustStage({
  args: ["-p"],
  directory,
  argv: [directory],
  acquire: async () => ({ certificates: [], fallbackReason: "helper-missing", codes: [] }),
})
if (result.action === "adopt") {
  let nested: unknown
  if (mode === "native-child" || mode === "shell-child") {
    const child = Bun.spawn([process.execPath, directory], {
      ...(mode === "shell-child" ? { env: { ...process.env } } : {}),
      stdout: "pipe", stderr: "pipe", timeout: 10_000,
    })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    nested = { code, stdout, stderr }
  }
  let tls: unknown
  if (mode?.startsWith("https:")) {
    const native = await fetch(mode).then((response) => response.ok, () => false)
    const bunFetch = await Bun.fetch(mode).then((response) => response.ok, () => false)
    const saved = await savedFetch(mode).then((response) => response.ok, () => false)
    const worker = await new Promise<boolean>((resolve) => {
      const source = "self.onmessage = async (event) => postMessage(await fetch(event.data).then((response) => response.ok, () => false))"
      const thread = new Worker(URL.createObjectURL(new Blob([source], { type: "application/javascript" })))
      const finish = (value: boolean) => { clearTimeout(timer); thread.terminate(); resolve(value) }
      const timer = setTimeout(() => finish(false), 5000)
      thread.onmessage = (event) => finish(event.data === true)
      thread.onerror = () => finish(false)
      thread.postMessage(mode)
    })
    const https = await new Promise<boolean>((resolve) => {
      const request = get(mode, (response) => { response.resume(); resolve(response.statusCode === 200) })
      request.on("error", () => resolve(false))
      request.setTimeout(5000, () => { request.destroy(); resolve(false) })
    })
    const websocket = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket(mode.replace("https:", "wss:"))
      const timer = setTimeout(() => { socket.close(); resolve(false) }, 5000)
      socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(true) }
      socket.onerror = () => { clearTimeout(timer); socket.close(); resolve(false) }
    })
    tls = { native, bunFetch, saved, worker, https, websocket }
  }
  console.log(JSON.stringify({
    marker: adoptedEngineTrust(),
    nested, tls,
    env: Object.fromEntries(["NODE_EXTRA_CA_CERTS", "NODE_USE_SYSTEM_CA", "SSL_CERT_FILE",
      "SSL_CERT_DIR", "BUN_OPTIONS", "SENPI_ENGINE_TRUST", "SENPI_ENGINE_TRUST_HOP"]
      .map((name) => [name, process.env[name] ?? null])),
  }))
} else if (result.action === "refuse") process.exitCode = 78
