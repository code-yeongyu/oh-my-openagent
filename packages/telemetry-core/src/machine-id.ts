import { createHash } from "node:crypto"
import os from "node:os"

import type { TelemetryOsProvider } from "./types"

export function getDefaultTelemetryOsProvider(): TelemetryOsProvider {
  return os
}

export function getTelemetryDistinctId(
  machineIdPrefix: string,
  osProvider: TelemetryOsProvider = getDefaultTelemetryOsProvider(),
): string {
  return createHash("sha256").update(`${machineIdPrefix}${osProvider.hostname()}`).digest("hex")
}
