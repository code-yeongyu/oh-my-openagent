import { z } from "zod"

import { GitEnvPrefixSchema } from "./git-env-prefix"

export const GitMasterConfigSchema = z.object({
  /** Opt in to an "Ultraworked with Sisyphus" footer in commit bodies (default: false). Can be boolean or custom string. */
  commit_footer: z.union([z.boolean(), z.string()]).default(false),
  /** Add the `Co-authored-by: sisyphus-dev-ai <sisyphus-dev-ai@users.noreply.github.com>` trailer once to every commit git-master writes (default: true). */
  include_co_authored_by: z.boolean().default(true),
  /** Environment variable prefix for all git commands (default: "GIT_MASTER=1"). Set to "" to disable. Allows custom git hooks to detect git-master skill usage. */
  git_env_prefix: GitEnvPrefixSchema,
})

export type GitMasterConfig = z.infer<typeof GitMasterConfigSchema>
