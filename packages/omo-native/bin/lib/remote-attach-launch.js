/**
 * `omo remote attach` holds a device-service connection and a local endpoint open while the engine's
 * attach TUI runs. The launcher therefore leaves through `exit` on every path: a TUI that cannot start
 * (missing engine, spawn error) would otherwise leave both open, and the command would never return.
 * When the remote side ends the attach, `runTui` gets that end (it asks the TUI to leave); once the TUI
 * is gone, so its terminal is restored, the end is reported and its exit code is the command's.
 */
export async function runRemoteAttachLaunch({ prepare, runTui, reportError, reportEnd, exit }) {
  let exitCode
  try {
    const launch = await prepare()
    if (launch) {
      let end
      await runTui(launch.engineArgs, launch.ended.then((value) => {
        end = value
      }))
      if (end) {
        reportEnd(end.message)
        exitCode = end.exitCode
      }
    }
  } catch (error) {
    reportError(error)
  } finally {
    exit(exitCode)
  }
}
