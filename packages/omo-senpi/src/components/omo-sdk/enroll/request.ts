import type { UserCode } from "../account/sign-in"

export type SshTarget = {
  readonly host: string
  readonly user?: string
  readonly port?: number
  readonly identityFile?: string
  /** The target's host key, `<type> <base64>`; checked instead of the caller's known hosts when given. */
  readonly hostKey?: string
}

export type EnrollRequest = {
  readonly ssh: SshTarget
  readonly deviceName?: string
  /** Replace this machine's earlier device when the account already has one for it. */
  readonly replace?: boolean
  /** Called once with the code a person approves; the only place the codes leave the SDK. */
  readonly onUserCode: (code: UserCode) => void | Promise<void>
  readonly signal?: AbortSignal
  readonly doriterm?: "skip"
}

// A destination word is passed to ssh after `--`, but a value that starts with "-", or holds whitespace, a control
// character or "@" in the wrong place, never reaches it.
const SAFE_WORD = /^[A-Za-z0-9._:[\]%-]+$/
const SAFE_USER = /^[A-Za-z0-9._-]+$/
const HOST_KEY =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/]+={0,2}$/

export type RequestProblem =
  "invalid_host" | "invalid_user" | "invalid_port" | "invalid_host_key" | "invalid_device_name"

export function requestProblem(request: EnrollRequest): RequestProblem | undefined {
  const { host, user, port, hostKey } = request.ssh
  if (host.startsWith("-") || !SAFE_WORD.test(host)) return "invalid_host"
  if (user !== undefined && (user.startsWith("-") || !SAFE_USER.test(user))) return "invalid_user"
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) return "invalid_port"
  if (hostKey !== undefined && !HOST_KEY.test(hostKey.trim())) return "invalid_host_key"
  const name = request.deviceName
  if (name !== undefined && (name.trim() === "" || name.length > 128 || /[\u0000-\u001f]/.test(name)))
    return "invalid_device_name"
  return undefined
}
