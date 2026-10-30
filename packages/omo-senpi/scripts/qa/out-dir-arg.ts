const OUT_DIR_FLAG = "--out-dir"

export class OutDirArgError extends Error {
  readonly argv: readonly string[]

  constructor(message: string, argv: readonly string[]) {
    super(`${message} (usage: <driver> [<out-dir> | ${OUT_DIR_FLAG} <out-dir>])`)
    this.name = "OutDirArgError"
    this.argv = argv
  }
}

export function resolveOutDirArg(argv: readonly string[], fallback: string): string {
  const [first, second, ...rest] = argv
  if (first === undefined) return fallback
  if (first === OUT_DIR_FLAG) {
    if (second === undefined || second.startsWith("-")) {
      throw new OutDirArgError(`${OUT_DIR_FLAG} requires a directory value`, argv)
    }
    if (rest.length > 0) throw new OutDirArgError(`unexpected extra argument(s): ${rest.join(" ")}`, argv)
    return second
  }
  if (first.startsWith("-")) throw new OutDirArgError(`unknown flag ${first}`, argv)
  if (second !== undefined) {
    throw new OutDirArgError(`unexpected extra argument(s): ${[second, ...rest].join(" ")}`, argv)
  }
  return first
}
