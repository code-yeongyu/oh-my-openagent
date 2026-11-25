// @ts-check

/**
 * How both editions' entries end a command that failed with an error nothing else answered (#15001): one line naming
 * it, exit 1, and the error's stack only under OMO_DEBUG.
 * @param {unknown} error
 * @param {{ env?: NodeJS.ProcessEnv, write?: (line: string) => void }} [io]
 * @returns {number} the exit code
 */
export function reportFatal(error, io = {}) {
  const env = io.env ?? process.env
  const write = io.write ?? ((line) => console.error(line))
  write(`omo: ${error instanceof Error ? error.message : String(error)}`)
  if (env.OMO_DEBUG && error instanceof Error && error.stack !== undefined) write(error.stack)
  return 1
}
