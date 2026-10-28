import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import type { RunOptions } from "./types"

export async function withRunProfile<T>(
  options: Pick<RunOptions, "profile" | "directory" | "attach">,
  execute: () => Promise<T>,
): Promise<T> {
  const { profile } = options
  if (profile === undefined) return await execute()

  if (profile.trim().length === 0) {
    throw new Error("Profile name must not be blank")
  }
  if (options.attach !== undefined) {
    throw new Error("--profile cannot be used with --attach; select a new server instead")
  }

  const loaded = loadOmoConfig({ cwd: options.directory ?? process.cwd(), harness: "opencode", profile })
  if (loaded.profile !== profile) {
    throw new Error(`Profile "${profile}" does not exist in the OMO configuration`)
  }

  const previousProfile = process.env.OMO_PROFILE
  process.env.OMO_PROFILE = profile
  try {
    return await execute()
  } finally {
    if (previousProfile === undefined) delete process.env.OMO_PROFILE
    else process.env.OMO_PROFILE = previousProfile
  }
}
