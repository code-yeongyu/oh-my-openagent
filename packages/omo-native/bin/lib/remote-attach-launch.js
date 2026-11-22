/**
 * `omo remote attach` holds a device-service connection and a local endpoint open while the engine's
 * attach TUI runs. The launcher therefore leaves through `exit` on every path: a TUI that cannot start
 * (missing engine, spawn error) would otherwise leave both open, and the command would never return.
 */
export async function runRemoteAttachLaunch({ prepare, runTui, reportError, exit }) {
  try {
    const engineArgs = await prepare()
    if (engineArgs) await runTui(engineArgs)
  } catch (error) {
    reportError(error)
  } finally {
    exit()
  }
}
