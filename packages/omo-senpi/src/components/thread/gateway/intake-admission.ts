import type { DeliveryRow } from "./types"

/** The device service's answer to "is this device admitted with the grant now" (5.6): no answer is `unknown`. */
export type IntakeAdmission = "admitted" | "refused" | "unknown"

export type IntakeVerdict = "admit" | "refuse" | "skip"

/**
 * One drain pass's admission check (5.6, A2.2). A row from this device is never asked about; an intake row (its
 * ledger id set) is admitted only on a positive answer, so a drain with no way to ask admits none. Each device is asked
 * at most once per pass; a device with no answer has all its rows skipped, so none of its rows overtakes another.
 */
export function intakeAdmissionPass(admit: ((device: string) => Promise<IntakeAdmission>) | undefined) {
  const answers = new Map<string, IntakeAdmission>()
  return async (row: DeliveryRow): Promise<IntakeVerdict> => {
    if (row.ledger_id == null) return "admit"
    const device = row.envelope.provenance?.device
    if (device === undefined || admit === undefined) return "skip"
    let answer = answers.get(device)
    if (answer === undefined) {
      try {
        answer = await admit(device)
      } catch {
        answer = "unknown"
      }
      answers.set(device, answer)
    }
    return answer === "admitted" ? "admit" : answer === "refused" ? "refuse" : "skip"
  }
}
