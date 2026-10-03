#!/usr/bin/env node
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  buildExtension,
  extensionBuildPaths,
  resolveBunExecutable,
  runBuildCommand,
  SENPI_LOADER_ALIASES,
} from "./build-extension-core.mjs"
import { checkExtensionCurrent } from "./check-extension-current.mjs"

export {
  buildExtension,
  checkExtensionCurrent,
  resolveBunExecutable,
  SENPI_LOADER_ALIASES,
}
export { toPortableBuildPath } from "./build-artifact.mjs"

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { scriptDir, outputPath, taskOutputPath, memberOutputPath, supervisorOutputPath, advisorRuntimeOutputPath, computerUseOutputPath } =
    extensionBuildPaths
  if (process.argv.includes("--check")) {
    runBuildCommand("node", [join(scriptDir, "build-daemon-launch-spec.mjs"), "--check"])
    runBuildCommand("node", [join(scriptDir, "stage-lsp-daemon-runtime.mjs"), "--check"])
    runBuildCommand("node", [join(scriptDir, "stage-ast-grep-mcp-runtime.mjs"), "--check"])
    runBuildCommand("node", [join(scriptDir, "stage-x-search-skill.mjs"), "--check"])
    const result = await checkExtensionCurrent()
    if (!result.ok) {
      console.error(`omo-senpi extension build is not current: ${result.reason}`)
      console.error(`output=${result.output}`)
      process.exit(1)
    }
    console.log(`omo-senpi extension build is current: ${result.output}`)
  } else {
    await buildExtension()
    console.log(`Built omo-senpi extensions: ${outputPath}, ${taskOutputPath}, ${memberOutputPath}, ${supervisorOutputPath}, ${advisorRuntimeOutputPath}, ${computerUseOutputPath}`)
  }
}
