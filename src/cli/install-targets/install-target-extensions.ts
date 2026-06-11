import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

export type TargetInstallResult = {
  target: "oh-my-pi" | "pi"
  path: string
  installed: boolean
  conflict?: string
}

function installLink(target: TargetInstallResult["target"], root: string, packageRoot: string): TargetInstallResult {
  const path = join(root, "oh-my-openagent")
  mkdirSync(root, { recursive: true })
  if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink() && resolve(root, readlinkSync(path)) === resolve(packageRoot)) {
      return { target, path, installed: true }
    }
    return { target, path, installed: false, conflict: "Existing extension path was left untouched." }
  }
  symlinkSync(resolve(packageRoot), path, "dir")
  return { target, path, installed: true }
}

export function installTargetExtensions(options: {
  packageRoot: string
  home?: string
  targets?: readonly ("oh-my-pi" | "pi")[]
}): TargetInstallResult[] {
  const home = options.home ?? homedir()
  const targets = options.targets ?? ["oh-my-pi", "pi"]
  return targets.map((target) =>
    installLink(
      target,
      target === "oh-my-pi" ? join(home, ".omp", "agent", "extensions") : join(home, ".pi", "agent", "extensions"),
      options.packageRoot,
    ),
  )
}
