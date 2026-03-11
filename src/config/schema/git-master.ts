import { z } from "zod"

import { GitEnvPrefixSchema } from "./git-env-prefix"

export const GitMasterConfigSchema = z.object({
  /** Add "Ultraworked with Sisyphus" footer to commit messages (default: true). Can be boolean or custom string. */
  commit_footer: z.union([z.boolean(), z.string()]).default(true),
  /** Add "Co-authored-by: Sisyphus" trailer to commit messages (default: true) */
  include_co_authored_by: z.boolean().default(true),
  /** Environment variable prefix for all git commands (default: "GIT_MASTER=1"). Set to "" to disable. Allows custom git hooks to detect git-master skill usage. */
  git_env_prefix: GitEnvPrefixSchema,
})

export type GitMasterConfig = z.infer<typeof GitMasterConfigSchema>
