import {
  MAX_PROJECT_CONFIG_DIRECTORY_DEPTH,
  resolveHomeDir,
  resolveOmoProfileName,
} from "@oh-my-opencode/omo-config-core"
import { userInfo } from "node:os"
import {
  getOpenCodeRuntimeConfigOptions,
  parseJsoncSafe,
  readJsoncFile,
} from "../shared"
import {
  getMisplacedCategoryConfigCandidates,
  type MisplacedCategoryDiagnosticOptions as MisplacedCategoryPathOptions,
  targetPath,
  userOmoTargetPath,
} from "./misplaced-category-config-paths"

export type MisplacedCategoryDiagnosticOptions = MisplacedCategoryPathOptions & {
  readonly environment?: NodeJS.ProcessEnv
}

const ACCOUNT_HOME_DIRECTORY = userInfo().homedir

function hasTopLevelCategories(config: unknown): boolean {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return false
  return Object.hasOwn(config, "categories")
}

export function getMisplacedCategoryConfigDiagnostics(
  projectDirectory: string,
  options: MisplacedCategoryDiagnosticOptions = {},
): string[] {
  const environment = options.environment ?? process.env
  const homeDirectory = options.homeDirectory ?? resolveHomeDir(environment)
  const profileName = resolveOmoProfileName({ env: environment })
  const openCodeHost = options.openCodeHost ??
    getOpenCodeRuntimeConfigOptions(environment)
  const diagnostics: string[] = []
  const candidates = getMisplacedCategoryConfigCandidates(
    projectDirectory,
    {
      accountHomeDirectory: options.accountHomeDirectory ?? ACCOUNT_HOME_DIRECTORY,
      disableProjectConfig: options.disableProjectConfig ??
        process.env.OPENCODE_DISABLE_PROJECT_CONFIG === "true",
      homeDirectory,
      maxProjectDepth: options.maxProjectDepth ?? MAX_PROJECT_CONFIG_DIRECTORY_DEPTH,
      openCodeHost,
      worktreeDirectory: options.worktreeDirectory,
    },
    profileName,
  )
  for (const candidate of candidates) {
    const config = readJsoncFile(candidate.filePath)
    if (!hasTopLevelCategories(config)) continue
    diagnostics.push(
      `OMO ignores "categories" in ${candidate.filePath}; move it to ${candidate.targetConfigPath}.`,
    )
  }

  const inlineContent = process.env.OPENCODE_CONFIG_CONTENT?.trim()
  const inlineConfig = inlineContent ? parseJsoncSafe(inlineContent).data : null
  if (hasTopLevelCategories(inlineConfig)) {
    diagnostics.push(
      `OMO ignores "categories" in OPENCODE_CONFIG_CONTENT; move it to ${targetPath(userOmoTargetPath(homeDirectory), profileName)}.`,
    )
  }
  return diagnostics
}
