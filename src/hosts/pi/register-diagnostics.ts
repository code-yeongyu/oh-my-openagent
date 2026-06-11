import type { PiExtensionApi, PiToolResult } from "./extension-api"
import { PI_DIAGNOSTIC_COMMAND, PI_DIAGNOSTIC_TOOL, PI_EXTENSION_LABEL } from "./manifest"

function createDiagnosticResult(): PiToolResult {
  return {
    content: [
      {
        type: "text",
        text: `${PI_EXTENSION_LABEL} Pi adapter loaded.`,
      },
    ],
  }
}

function createEmptyParametersSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {},
    additionalProperties: false,
  }
}

export function registerPiDiagnostics(pi: PiExtensionApi): void {
  pi.registerCommand(PI_DIAGNOSTIC_COMMAND, {
    description: "Report whether the Oh My OpenAgent Pi adapter is loaded.",
    handler: (_argument, context) => {
      context.ui.notify(`${PI_EXTENSION_LABEL} Pi adapter loaded.`, "info")
    },
  })

  pi.registerTool({
    name: PI_DIAGNOSTIC_TOOL,
    label: "OMO Pi diagnostic",
    description: "Reports whether the Oh My OpenAgent Pi adapter is loaded.",
    parameters: createEmptyParametersSchema(),
    execute: async () => createDiagnosticResult(),
  })
}
