import os from "node:os"

import type { TelemetryOsProvider } from "./types"

export function getDefaultTelemetryOsProvider(): TelemetryOsProvider {
  return os
}
