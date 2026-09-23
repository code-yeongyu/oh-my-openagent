import { homedir } from "node:os"
import { dirname } from "node:path"

import { createStandaloneParityComponent } from "../components/standalone-parity"
import type { ComponentLogger, SenpiExtensionAPI } from "./types"

export const standaloneParityComponents = [
  createStandaloneParityComponent({ betaRoot: dirname(homedir()) }),
] as const

const requiredApiMethods = ["on", "registerTool", "registerCommand", "registerFlag", "getFlag", "sendMessage", "sendUserMessage"] as const

const logger: ComponentLogger = {
  info(message, details) {
    console.info(message, details)
  },
  warn(message, details) {
    console.warn(message, details)
  },
  error(message, details) {
    console.error(message, details)
  },
}

function isSenpiExtensionAPI(value: unknown): value is SenpiExtensionAPI {
  return value !== null
    && typeof value === "object"
    && requiredApiMethods.every((method) => typeof Reflect.get(value, method) === "function")
}

export default async function registerStandaloneParityExtension(pi: unknown): Promise<void> {
  if (!isSenpiExtensionAPI(pi)) {
    logger.warn("standalone parity ExtensionAPI version mismatch; extension disabled")
    return
  }
  await standaloneParityComponents[0].register(pi, {
    logger,
    sharedHostEnabled: pi.sharedHostEnabled === true,
    config: { getFlag: (name) => pi.getFlag(name) },
  })
}
