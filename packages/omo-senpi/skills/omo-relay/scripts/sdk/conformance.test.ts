import { expect, test } from "bun:test"
import type { BunshinClient, StandaloneMachine } from "../../../../vendor/bunshin-ts/types/bunshin-ts/src/types.d.ts"
import type { FleetPort } from "./ports.ts"

// The shipped bundle carries no declarations, so this compile-time check is what ties FleetPort to the
// vendored client: if the client's shape moves, `bun check` on this skill's tsconfig fails here.
const asFleetPort = (client: BunshinClient): FleetPort<StandaloneMachine> => client

test("#given the vendored fleet client type #when used as the helpers' fleet port #then it is assignable", () => {
  expect(typeof asFleetPort).toBe("function")
})
