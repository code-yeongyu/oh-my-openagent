import { BUNSHIN_TS_CELL_HINT } from "../../extension/sdk-root-provisioning"

/** Global the prelude installs. Senpi re-runs the snippet only while this name is missing. */
export const JS_KERNEL_GUARD_GLOBAL = "omoJsKernelGuard"

export const PROCESS_EXIT_IN_CELL = "ProcessExitInCell"

/**
 * Statements the JS kernel evals before a cell, once the guard global is missing.
 * The kernel binds the real `process.exit` at process start and uses that binding for its own
 * shutdown. This replacement is what user code and imported modules see, so `process.exit` inside
 * a cell throws instead of ending the worker.
 */
export function jsKernelGuardPreludeSource(): string {
  return [
    `globalThis[${JSON.stringify(JS_KERNEL_GUARD_GLOBAL)}] = true`,
    "process.exit = function omoCellProcessExit(code) {",
    "  const error = new Error(",
    '    "process.exit(" + String(code ?? 0) + ") ran inside a JavaScript cell. The kernel stayed up and its globals were kept."',
    "  )",
    `  error.name = ${JSON.stringify(PROCESS_EXIT_IN_CELL)}`,
    "  throw error",
    "}",
  ].join("\n")
}

export const jsKernelGuardPrelude = {
  javascript: jsKernelGuardPreludeSource(),
  python: `${JS_KERNEL_GUARD_GLOBAL} = True\n`,
  documentation: `${BUNSHIN_TS_CELL_HINT} Calling process.exit inside a JS cell throws ${PROCESS_EXIT_IN_CELL} and leaves the kernel and its globals in place.`,
  exports: [JS_KERNEL_GUARD_GLOBAL],
} as const
