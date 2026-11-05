import { testBudgetSignal } from "../../../../../../test-support/test-deadline"
import { withContractHost, type ContractHost, type ContractHostOptions } from "./contract-host"

/** withContractHost for test bodies: the host's listen wait takes the remaining test budget;
 * its close wait runs in finally and keeps contract-host's fixed teardown bound (#10814). */
export function withBudgetedContractHost(options: ContractHostOptions, exercise: (host: ContractHost) => Promise<void>): Promise<void> {
  return withContractHost({ ...options, bounds: { ...options.bounds, listen: testBudgetSignal } }, exercise)
}
