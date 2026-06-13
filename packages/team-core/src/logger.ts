export type TeamCoreLog = (message: string, data?: unknown) => void

let activeLogger: TeamCoreLog = () => undefined

export function setTeamCoreLogger(logger: TeamCoreLog): void {
  activeLogger = logger
}

export function log(message: string, data?: unknown): void {
  activeLogger(message, data)
}
