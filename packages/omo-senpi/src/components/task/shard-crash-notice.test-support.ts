import type { CapturedUi } from "./runtime-context"

export const SOCKET_A = "/tmp/dh-t10/rpc/shards/p-aaaaaaaaaaaaaaaa.sock"

type Notified = { readonly text: string; readonly type: string | undefined }

export function uiRecorder(): { readonly ui: CapturedUi; readonly notified: Notified[] } {
  const notified: Notified[] = []
  const ui: CapturedUi = {
    notify: (text, type) => notified.push({ text, type }),
    setStatus: () => undefined,
    setWidget: () => undefined,
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
  }
  return { ui, notified }
}
