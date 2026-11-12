/**
 * The temp dir the test preload keeps for the whole process and removes with the run root (test-temp-root.ts).
 * A fixture root that outlives its test file, such as one behind a module mock later files can still write
 * through, belongs here: no test or file can own its removal (#13286).
 */
export function processTempDir(): string {
  const dir = process.env.OMO_TEST_PROCESS_TMPDIR
  if (!dir) throw new Error("OMO_TEST_PROCESS_TMPDIR is unset: run bun test with the repo's test preload")
  return dir
}
