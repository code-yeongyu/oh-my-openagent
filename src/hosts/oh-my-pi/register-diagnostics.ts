import type { OhMyPiExtensionApi, OhMyPiToolResult } from "./extension-api"
import {
  OH_MY_PI_DIAGNOSTIC_COMMAND,
  OH_MY_PI_DIAGNOSTIC_TOOL,
  OH_MY_PI_EXTENSION_LABEL,
} from "./manifest"

function createDiagnosticResult(): OhMyPiToolResult {
  return {
    content: [
      {
        type: "text",
        text: `${OH_MY_PI_EXTENSION_LABEL} Oh My Pi adapter loaded.`,
      },
    ],
  }
}

export function registerOhMyPiDiagnostics(pi: OhMyPiExtensionApi): void {
  pi.registerCommand(OH_MY_PI_DIAGNOSTIC_COMMAND, {
    description: "Report whether the Oh My OpenAgent Oh My Pi adapter is loaded.",
    handler: (_argument, context) => {
      context.ui.notify(`${OH_MY_PI_EXTENSION_LABEL} adapter loaded.`, "info")
    },
  })

  pi.registerTool({
    name: OH_MY_PI_DIAGNOSTIC_TOOL,
    label: "OMO diagnostic",
    description: "Reports whether the Oh My OpenAgent Oh My Pi adapter is loaded.",
    parameters: pi.zod.object({}),
    execute: async () => createDiagnosticResult(),
  })
}
