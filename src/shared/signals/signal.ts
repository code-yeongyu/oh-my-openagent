class Signal {
  static readonly SIGINT = new Signal("SIGINT", 2)
  static readonly SIGTERM = new Signal("SIGTERM", 15)
  static readonly SIGKILL = new Signal("SIGKILL", 9)
  static readonly SIGILL = new Signal("SIGILL", 4)
  static readonly SIGBREAK = new Signal("SIGBREAK", 21)

  private static readonly ALL: Signal[] = [
    Signal.SIGINT,
    Signal.SIGTERM,
    Signal.SIGKILL,
    Signal.SIGILL,
    Signal.SIGBREAK,
  ]

  readonly name: NodeJS.Signals
  readonly code: number
  readonly exitCode: number

  private constructor(name: NodeJS.Signals, code: number) {
    this.name = name
    this.code = code
    this.exitCode = 128 + code
  }

  toString(): string {
    return this.name
  }

  static fromName(name: string): Signal | undefined {
    return Signal.ALL.find((signal) => signal.name === name)
  }

  static fromExitCode(exitCode: number): Signal | undefined {
    return Signal.ALL.find((signal) => signal.exitCode === exitCode)
  }
}

export { Signal }
