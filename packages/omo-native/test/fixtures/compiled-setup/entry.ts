import { runCompiledLauncher } from "../../../compile-entry"

const runtimeRoot = process.env.OMO_COMPILED_SETUP_RUNTIME_ROOT
if (runtimeRoot === undefined) throw new Error("OMO_COMPILED_SETUP_RUNTIME_ROOT is required")
await runCompiledLauncher(process.argv.slice(2), runtimeRoot, "fixture", runtimeRoot)
