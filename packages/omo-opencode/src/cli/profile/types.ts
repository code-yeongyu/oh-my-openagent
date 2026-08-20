import type { OmoConfigEnv } from "@oh-my-opencode/omo-config-core"

export type ProfileCommandOptions = {
  readonly cwd?: string
  readonly environment?: OmoConfigEnv
  readonly errorOutput?: (line: string) => void
  readonly output?: (line: string) => void
}
