import { testBudgetSignal } from "../../../../../../test-support/test-deadline"
import { withContractHost, type ContractHost, type ContractHostOptions } from "./contract-host"

/** withContractHost for test bodies: the host's listen and close waits take the remaining test budget (#10814). */
export function withBudgetedContractHost(options: ContractHostOptions, exercise: (host: ContractHost) => Promise<void>): Promise<void> {
  return withContractHost({ ...options, deadline: testBudgetSignal }, exercise)
}
