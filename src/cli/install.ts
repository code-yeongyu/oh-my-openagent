import packageJson from "../../package.json" with { type: "json" }
import { runCliInstaller } from "./cli-installer"
import { runTuiInstaller } from "./tui-installer"
import type { InstallArgs } from "./types"

const VERSION = packageJson.version

export async function install(args: InstallArgs): Promise<number> {
  return args.tui ? runTuiInstaller(args, VERSION) : runCliInstaller(args, VERSION)
}
