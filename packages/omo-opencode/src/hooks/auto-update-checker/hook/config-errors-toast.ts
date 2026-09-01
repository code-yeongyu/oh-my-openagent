import type { PluginInput } from "@opencode-ai/plugin"
import { getConfigLoadErrors, clearConfigLoadErrors } from "../../../shared/config-errors"
import { log } from "../../../shared/logger"
import { ignoreToastError } from "./ignore-toast-error"

export async function showConfigErrorsIfAny(ctx: PluginInput): Promise<void> {
  const errors = getConfigLoadErrors()
  if (errors.length === 0) return

  const errorMessages = errors.map((error: { path: string; error: string }) => `${error.path}: ${error.error}`).join("\n")
  await ctx.client.tui
    .showToast({
      body: {
        title: "Config Load Error",
        message: `Failed to load config:\n${errorMessages}`,
        variant: "error" as const,
        duration: 10000,
      },
    })
    .catch(ignoreToastError)

  log(`[auto-update-checker] Config load errors shown: ${errors.length} error(s)`) 
  clearConfigLoadErrors()
}
