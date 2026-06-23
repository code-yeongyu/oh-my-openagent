export interface EvalFixture {
  name: string
  description: string
  run(): Promise<EvalResult>
}

export interface EvalResult {
  fixture: string
  passed: boolean
  score?: number
  details?: string
  error?: string
}

export interface EvalSuiteResult {
  total: number
  passed: number
  failed: number
  results: EvalResult[]
}

export class EvalHarness {
  private fixtures: EvalFixture[] = []

  register(fixture: EvalFixture): void {
    this.fixtures.push(fixture)
  }

  async runAll(): Promise<EvalSuiteResult> {
    const results: EvalResult[] = []

    for (const fixture of this.fixtures) {
      try {
        const result = await fixture.run()
        results.push(result)
      } catch (error) {
        results.push({
          fixture: fixture.name,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const passed = results.filter((r) => r.passed).length
    return {
      total: results.length,
      passed,
      failed: results.length - passed,
      results,
    }
  }

  async runByName(name: string): Promise<EvalResult | undefined> {
    const fixture = this.fixtures.find((f) => f.name === name)
    if (!fixture) return undefined
    try {
      return await fixture.run()
    } catch (error) {
      return {
        fixture: name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export const globalEvalHarness = new EvalHarness()
