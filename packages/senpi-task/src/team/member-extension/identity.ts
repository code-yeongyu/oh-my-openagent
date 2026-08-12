export const MEMBER_IDENTITY_ENV = "SENPI_TASK_MEMBER"

/**
 * Whether THIS process is a team member child, which owns `task_send` through the member extension.
 * senpi drops an ENTIRE extension whose tool name is already registered, so a host extension that
 * registers its own `task_send` here loses every other tool, agent, and provider it carries.
 */
export function isTeamMemberProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  const identity = env[MEMBER_IDENTITY_ENV]
  return identity !== undefined && identity.length > 0
}
