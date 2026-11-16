import { pairTest } from "./pair-test"

/** #13006: one message interface, two transports; route-parity.test.ts proves each method below is sent on both legs. */
export const ROUTE_PARITY = pairTest({
  test: "packages/omo-senpi/src/components/thread/route-parity.test.ts",
  covers: ["admit_external_message"],
})
