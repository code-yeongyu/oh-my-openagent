import { appendFile } from "node:fs/promises"

const TOAST_LOG_PATH = "/tmp/idm-toasts.log"

interface ToastBody {
  title?: string
  message?: string
  variant?: string
  duration?: number
}

interface ToastShowArgs {
  body?: ToastBody
}

interface TuiClient {
  showToast: (args: ToastShowArgs) => Promise<unknown>
}

interface ClientWithTui {
  tui: TuiClient
}

let installed = false
let originalShowToast: TuiClient["showToast"] | null = null
let installedFor: TuiClient | null = null

function logToastFireAndForget(args: ToastShowArgs): void {
  const ts = new Date().toISOString()
  const body = args?.body ?? {}
  const line = JSON.stringify({
    ts,
    title: body.title ?? null,
    message: body.message ?? null,
    variant: body.variant ?? null,
    duration: body.duration ?? null,
  })
  appendFile(TOAST_LOG_PATH, `${line}\n`).catch((err) => {
    process.stderr.write(`[toast-tap] failed to append: ${err instanceof Error ? err.message : String(err)}\n`)
  })
}

export function installToastTap(client: ClientWithTui): void {
  if (installed) return
  if (!client?.tui || typeof client.tui.showToast !== "function") return
  const original = client.tui.showToast
  originalShowToast = original
  installedFor = client.tui
  const bound = original.bind(client.tui)
  client.tui.showToast = async (args: ToastShowArgs) => {
    logToastFireAndForget(args)
    return bound(args)
  }
  installed = true
}

export function uninstallToastTap(client: ClientWithTui): void {
  if (!installed) return
  if (!client?.tui) return
  if (installedFor && installedFor !== client.tui) return
  if (originalShowToast) {
    client.tui.showToast = originalShowToast
  }
  originalShowToast = null
  installedFor = null
  installed = false
}

export function getToastLogPath(): string {
  return TOAST_LOG_PATH
}

export function isToastTapInstalled(): boolean {
  return installed
}
