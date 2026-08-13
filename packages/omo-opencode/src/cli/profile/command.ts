import { Command } from "commander"
import { runProfileClear, runProfileCurrent, runProfileList, runProfileUse } from "./profile"

function setExitCode(exitCode: number): void {
  process.exitCode = exitCode
}

export function createProfileCommand(): Command {
  const profile = new Command("profile").description("Manage named OMO configuration profiles")

  profile.command("list").description("List profiles and mark the effective active profile").action(() => {
    setExitCode(runProfileList())
  })

  profile.command("current").description("Show the effective active profile and its source").action(() => {
    setExitCode(runProfileCurrent())
  })

  profile.command("use <name>").description("Persist a user-level active profile").action((name: string) => {
    setExitCode(runProfileUse(name))
  })

  profile.command("clear").description("Remove the persisted user-level active profile").action(() => {
    setExitCode(runProfileClear())
  })

  profile.addHelpText("after", `
Activation precedence: explicit profile, OMO_PROFILE, OCX_PROFILE,
OPENCODE_CONFIG_DIR ending in profiles/<name>, then persisted active_profile.
`)

  return profile
}
