import { adoptedEngineTrust } from "@code-yeongyu/senpi/engine-trust"
import { runTrustStage } from "../../trust-stage"
import { get } from "node:https"

// Captured before the trust stage runs, as a module that saves the global reference at load time would.
const savedFetch = fetch
const directory = process.argv[2]
if (directory === undefined) throw new Error("usage: trust-stage-probe <directory> [mode]")
const mode = process.argv[3]
/** One TLS channel, bounded: a hang reports "timeout", never `false`, so it cannot pass for a rejection. */
function bounded(attempt: (signal: AbortSignal) => Promise<boolean>): Promise<boolean | "timeout"> {
  const controller = new AbortController()
  return new Promise((resolve) => {
    const timer = setTimeout(() => { resolve("timeout"); controller.abort() }, 5000)
    void attempt(controller.signal).then((value) => { clearTimeout(timer); resolve(value) })
  })
}
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
    // Concurrent, so a server that hangs every channel still answers within one 5 s bound.
    const [native, bunFetch, saved, worker, https, websocket] = await Promise.all([
      bounded((signal) => fetch(mode, { signal }).then((response) => response.ok, () => false)),
      bounded((signal) => Bun.fetch(mode, { signal }).then((response) => response.ok, () => false)),
      bounded((signal) => savedFetch(mode, { signal }).then((response) => response.ok, () => false)),
      bounded((signal) => new Promise<boolean>((resolve) => {
        const source = "self.onmessage = async (event) => postMessage(await fetch(event.data).then((response) => response.ok, () => false))"
        const thread = new Worker(URL.createObjectURL(new Blob([source], { type: "application/javascript" })))
        const finish = (value: boolean) => { thread.terminate(); resolve(value) }
        signal.addEventListener("abort", () => finish(false))
        thread.onmessage = (event) => finish(event.data === true)
        thread.onerror = () => finish(false)
        thread.postMessage(mode)
      })),
      bounded((signal) => new Promise<boolean>((resolve) => {
        const request = get(mode, { signal }, (response) => { response.resume(); resolve(response.statusCode === 200) })
        request.on("error", () => resolve(false))
      })),
      bounded((signal) => new Promise<boolean>((resolve) => {
        const socket = new WebSocket(mode.replace("https:", "wss:"))
        const finish = (value: boolean) => { socket.close(); resolve(value) }
        signal.addEventListener("abort", () => finish(false))
        socket.onopen = () => finish(true)
        socket.onerror = () => finish(false)
      })),
    ])
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
