import { OmoConfigWriteError } from "../writer"
import { configFileErrorCode } from "../loader/diagnostic-values"
import { MigrationTransactionError, MigrationValidationError } from "./types"

/** Only errors constructed by config-core have a value-free public message. */
export function migrationDiagnosticError(error: unknown): string {
  return error instanceof MigrationTransactionError || error instanceof MigrationValidationError || error instanceof OmoConfigWriteError
    ? error.message
    : `Configuration migration failed${configFileErrorCode(error)}; check the source and target config files`
}
