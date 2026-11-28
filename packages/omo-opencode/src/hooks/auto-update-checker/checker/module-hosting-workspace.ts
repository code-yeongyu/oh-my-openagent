import { basename, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { PACKAGE_NAME } from "../constants"
import { findPackageJsonUp } from "./package-json-locator"

const NODE_MODULES = "node_modules"

/**
 * The workspace whose `node_modules` holds the plugin the module at `moduleUrl`
 * was loaded from, or null when it does not run from an install layout (a
 * source tree or linked checkout).
 *
 * The bundle runs from the `oh-my-opencode` payload. Installed through the
 * `oh-my-openagent` wrapper, the payload sits in `<workspace>/node_modules/`
 * when the package manager hoists it, and in
 * `<workspace>/node_modules/oh-my-openagent/node_modules/` when it keeps it
 * nested; both layouts name the same workspace.
 */
export function findModuleHostingWorkspace(moduleUrl: string): string | null {
  const packageJsonPath = findPackageJsonUp(dirname(fileURLToPath(moduleUrl)))
  if (!packageJsonPath) return null
  const nodeModulesDir = dirname(dirname(packageJsonPath))
  if (basename(nodeModulesDir) !== NODE_MODULES) return null
  const owner = dirname(nodeModulesDir)
  if (basename(owner) === PACKAGE_NAME && basename(dirname(owner)) === NODE_MODULES) return dirname(dirname(owner))
  return owner
}
