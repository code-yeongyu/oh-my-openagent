import { spawn } from "bun"
import color from "picocolors"

export interface TestResult {
  total: number
  passed: number
  failed: number
  skipped: number
  duration: number
  failureDetails: string[]
}

export interface TestRunnerOptions {
  verbose?: boolean
}

export async function runTests(options: TestRunnerOptions = {}): Promise<TestResult> {
  const start = performance.now()
  
  // Run bun test
  // We use --reporter=dots to get a clean output if not verbose
  // But wait, we need to parse the final summary.
  const args = ["test"]
  if (!options.verbose) {
    // args.push("--dots") // dots reporter is less useful for parsing summary
  }

  const proc = spawn(["bun", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  const duration = Math.round(performance.now() - start)
  const fullOutput = stdout + stderr

  // Parse summary from output
  // Example: " 131 pass\n 0 fail\n 1 skip"
  const passedMatch = fullOutput.match(/(\d+)\s+pass/)
  const failedMatch = fullOutput.match(/(\d+)\s+fail/)
  const skippedMatch = fullOutput.match(/(\d+)\s+skip/)
  const totalMatch = fullOutput.match(/Ran\s+(\d+)\s+tests/)

  const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0
  const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0
  const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0
  const total = totalMatch ? parseInt(totalMatch[1], 10) : (passed + failed + skipped)

  // Extract failure details
  const failureDetails: string[] = []
  if (failed > 0) {
    // Simple heuristic to find failure blocks in bun test output
    // Bun test failure output usually starts with "fail:" or shows a diff
    // For now, let's just include the whole output if verbose, or try to isolate errors
    if (options.verbose) {
      failureDetails.push(fullOutput)
    } else {
      // Try to extract lines containing "error:" or "fail:"
      const lines = fullOutput.split("\n")
      let inFailure = false
      let currentFailure = ""
      
      for (const line of lines) {
        if (line.includes("fail:") || line.includes("error:")) {
          inFailure = true
          if (currentFailure) failureDetails.push(currentFailure)
          currentFailure = line
        } else if (inFailure && line.trim() === "") {
          inFailure = false
          failureDetails.push(currentFailure)
          currentFailure = ""
        } else if (inFailure) {
          currentFailure += "\n" + line
        }
      }
      if (currentFailure) failureDetails.push(currentFailure)
    }
  }

  if (options.verbose) {
    console.log(fullOutput)
  }

  return {
    total,
    passed,
    failed,
    skipped,
    duration,
    failureDetails,
  }
}
