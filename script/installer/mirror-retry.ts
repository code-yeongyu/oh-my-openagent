import { MirrorPlanError } from "./mirror-plan"

const ATTEMPTS = 3

export async function withRetry<T>(
  what: string,
  action: () => Promise<T>,
  sleep: (ms: number) => Promise<unknown> = Bun.sleep,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action()
    } catch (error) {
      if (attempt >= ATTEMPTS || error instanceof MirrorPlanError) throw error
      console.log(`[mirror] ${what} failed (attempt ${attempt}/${ATTEMPTS}): ${String(error).split("\n")[0]}; retrying`)
      await sleep(attempt * 5_000)
    }
  }
}
