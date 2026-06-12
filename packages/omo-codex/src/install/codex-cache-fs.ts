export { fileExistsStrict, isPlainRecord } from "@oh-my-opencode/utils"

export function isNodeErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error
}
