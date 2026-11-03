/** No user action means automatic recovery, not a user-visible notice. */
export function userActionNotice(reason: string, action: string): string
export function userActionNotice(reason: string, action: string | undefined): string | undefined
export function userActionNotice(reason: string, action: string | undefined): string | undefined {
  return action === undefined ? undefined : `${reason} ${action}`
}
