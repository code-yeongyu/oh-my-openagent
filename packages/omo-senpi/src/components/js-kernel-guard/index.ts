import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { BUNSHIN_TS_CELL_HINT } from "../../extension/sdk-root-provisioning"
import { jsKernelGuardPrelude } from "./prelude"

export const JS_KERNEL_GUARD_COMPONENT_NAME = "js-kernel-guard"
export const JS_KERNEL_GUARD_TOOL_NAME = "js_kernel_guard"

const PARAMETERS = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const

/**
 * Eval-only tool whose kernel prelude stops `process.exit` from killing the JS worker.
 * Senpi includes an eval-exposed tool's prelude even while the tool is withheld from the model,
 * so the guard is installed before the first cell and stays for the life of that kernel.
 */
export function createJsKernelGuardComponent(): OmoSenpiComponent {
  return {
    name: JS_KERNEL_GUARD_COMPONENT_NAME,
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      pi.registerTool({
        name: JS_KERNEL_GUARD_TOOL_NAME,
        label: "JS kernel guard",
        description: BUNSHIN_TS_CELL_HINT,
        parameters: PARAMETERS,
        exposure: "eval",
        permissionParser: () => [],
        executionMode: "parallel",
        kernelPrelude: jsKernelGuardPrelude,
        async execute() {
          return { content: [{ type: "text", text: BUNSHIN_TS_CELL_HINT }], details: {} }
        },
      })
    },
  }
}
