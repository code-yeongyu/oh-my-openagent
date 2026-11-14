// The --all tally of the live Windows driver (R55). A scenario whose precondition names a reason
// is BLOCKED and never runs; pass counts only scenarios that ran their oracle and passed; a run
// that fails or throws is a fail. One 'SET windows pass=<n> fail=<n> blocked=<n>' line ends the
// output, and the exit is non-zero when fail > 0.

export type Counts = { readonly pass: number; readonly fail: number; readonly blocked: number }

export type Summary = Counts & { readonly exitCode: 0 | 1 }

export type Candidate = {
  readonly name: string
  /** A reason this host cannot run the scenario, or undefined when it can. */
  readonly precondition: () => Promise<string | undefined>
}

export function setLine(counts: Counts): string {
  return `SET windows pass=${counts.pass} fail=${counts.fail} blocked=${counts.blocked}`
}

export async function runAll(
  candidates: readonly Candidate[],
  runOne: (name: string) => Promise<boolean>,
  print: (line: string) => void,
): Promise<Summary> {
  let pass = 0
  let fail = 0
  let blocked = 0
  for (const candidate of candidates) {
    const reason = await candidate.precondition()
    if (reason !== undefined) {
      blocked += 1
      print(`BLOCKED ${candidate.name} ${reason}`)
      continue
    }
    let passed = false
    try {
      passed = await runOne(candidate.name)
    } catch (error) {
      print(`FAIL ${candidate.name} ${error instanceof Error ? error.message : String(error)}`)
    }
    if (passed) pass += 1
    else fail += 1
  }
  print(setLine({ pass, fail, blocked }))
  return { pass, fail, blocked, exitCode: fail > 0 ? 1 : 0 }
}
