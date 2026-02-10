import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../../shared/logger"
import { showSpinnerToast } from "./spinner-toast"

export async function showVersionToast(ctx: PluginInput, version: string | null, message: string): Promise<void> {
  const displayVersion = version ?? "unknown"
  await showSpinnerToast(ctx, displayVersion, message)
  log(`[auto-update-checker] Startup toast shown: v${displayVersion}`)
}

export async function showLocalDevToast(
  ctx: PluginInput,
  version: string | null,
  isSisyphusEnabled: boolean
): Promise<void> {
  const displayVersion = version ?? "dev"
  const message = isSisyphusEnabled
    ? "Sisyphus running in local development mode."
    : "Running in local development mode. oMoMoMo..."
  await showSpinnerToast(ctx, `${displayVersion} (dev)`, message)
  log(`[auto-update-checker] Local dev toast shown: v${displayVersion}`)
}
