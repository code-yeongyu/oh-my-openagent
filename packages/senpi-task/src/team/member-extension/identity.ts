export const MEMBER_IDENTITY_ENV = "SENPI_TASK_MEMBER"
export const MEMBER_TASK_ID_ENV = "SENPI_TASK_MEMBER_TASK_ID"
export const MEMBER_TEAM_CONFIG_ENV = "SENPI_TASK_TEAM_CONFIG"
export const MEMBER_PROCESS_ENV_NAMES = [MEMBER_IDENTITY_ENV, MEMBER_TASK_ID_ENV, MEMBER_TEAM_CONFIG_ENV] as const
export const MEMBER_EXTENSION_BUNDLE_NAME = "omo-member.js"

export const WORKPOOL_STATE_DIR_ENV = "OMO_WORKPOOL_STATE_DIR"
export const WORKPOOL_TASK_ID_ENV = "OMO_WORKPOOL_TASK_ID"
export const WORKPOOL_PROCESS_ENV_NAMES = [WORKPOOL_STATE_DIR_ENV, WORKPOOL_TASK_ID_ENV] as const

export function isTeamMemberProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  const identity = env[MEMBER_IDENTITY_ENV]
  return identity !== undefined && identity.length > 0
}
