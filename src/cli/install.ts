import packageJson from "../../package.json" with { type: "json" }
import type { InstallArgs } from "./types"
import { runCliInstaller } from "./cli-installer"
import { runTuiInstaller } from "./tui-installer"

const VERSION = packageJson.version

export async function install(args: InstallArgs): Promise<number> {
  return args.tui ? runTuiInstaller(args, VERSION) : runCliInstaller(args, VERSION)
}
