import { NOTICE_TOKENS } from "./shard-socket"

export const HOST_NOTICE_TOKENS = {
  ...NOTICE_TOKENS,
  store_register_failed: "host_notice:store_register_failed",
  store_index_unavailable: "host_notice:store_index_unavailable",
  own_host_unreachable: "host_notice:own_host_unreachable",
  host_incompatible: "host_unavailable:host_incompatible",
} as const

export type HostNoticeKind = keyof typeof HOST_NOTICE_TOKENS
export type HostNoticeToken = (typeof HOST_NOTICE_TOKENS)[HostNoticeKind]

/** `detail` names the endpoint a notice is about (a socket path), never a secret. */
export type HostNoticeSink = (token: HostNoticeToken, detail?: string) => void

export function onceNoticeSink(sink: HostNoticeSink | undefined): (kind: HostNoticeKind, detail?: string) => void {
  const sent = new Set<string>()
  return (kind, detail) => {
    const token = HOST_NOTICE_TOKENS[kind]
    const key = detail === undefined ? token : `${token}\u0000${detail}`
    if (sent.has(key)) return
    sent.add(key)
    sink?.(token, detail)
  }
}
