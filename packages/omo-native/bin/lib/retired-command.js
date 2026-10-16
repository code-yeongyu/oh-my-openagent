/** Old app-server invocations must never fall through into a model turn. */
export function refuseRetiredCommand(args) {
  if (args[0] !== "app-server") return false
  process.stderr.write("omo app-server has been removed. Use omo --mode rpc or omo host.\n")
  process.exitCode = 2
  return true
}
