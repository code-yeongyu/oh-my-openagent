// The one reason a child carries when its connection to the task host dropped and it never resumed
// (omo#9403). The runner writes it; steering reads it back off the record to explain the loss.
export const TRANSPORT_LOST_REASON = "transport lost: the connection to the task host dropped and the child did not resume"

export function isTransportLostMessage(message: string | undefined): boolean {
  return message?.startsWith(TRANSPORT_LOST_REASON) === true
}
