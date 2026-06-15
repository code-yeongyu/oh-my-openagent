import { createLogger, type LoggerTestOverrides } from "@oh-my-opencode/utils"

import { LOG_FILENAME } from "./plugin-identity"

const logger = createLogger({ logFileName: LOG_FILENAME })

export const log = logger.log
export const getLogFilePath = logger.getLogFilePath

export function _setLoggerForTesting(overrides: LoggerTestOverrides): void {
  logger._setLoggerForTesting(overrides)
}

export function _resetLoggerForTesting(): void {
  logger._resetLoggerForTesting()
}

export function _flushForTesting(): void {
  logger._flushForTesting()
}
