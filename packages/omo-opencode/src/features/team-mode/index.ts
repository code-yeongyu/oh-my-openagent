export * from "./types"
export * from "./team-worktree"

import { setTeamCoreLogger } from "@oh-my-opencode/team-core"

import { log } from "../../shared/logger"

setTeamCoreLogger(log)
