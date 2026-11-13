const runDir = process.argv[2]
if (runDir === undefined) throw new TypeError("run directory is required")
process.stderr.write(`${"x".repeat(8 * 1024)}\nerror: fixture supervisor overflow\n`)
throw new Error("fixture supervisor overflow")

export {}
