// Fake DeepSeek Harness headless entry for tests. argv[2] selects the mode:
// "ok" prints the task text and exits 0; "fail" prints an error and exits 1;
// "hang" never exits.
const mode = process.argv[2] ?? "ok"

if (mode === "hang") {
  setInterval(() => {}, 1000)
} else if (mode === "fail") {
  process.stderr.write("model exploded\n")
  process.exit(1)
} else {
  const task = process.argv[process.argv.length - 1]
  process.stdout.write(`RESULT: ${task}\n`)
  process.exit(0)
}
