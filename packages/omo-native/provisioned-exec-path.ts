// Windows continues in-process after provisioning (a re-exec there loops through
// AssignProcessToJobObject, f9f483753), so `process.execPath` keeps naming the downloaded executable.
// Engine modules that locate files beside the executable (pi-pty's package.json and native prebuild,
// senpi's `getPackageDir()` fallback) would then look in the download folder, which holds only the
// executable (#7485). The provisioned runtime is a byte copy of this executable with the payload
// beside it, so naming it is what a re-exec would have produced.
export function adoptProvisionedExecPath(provisioned: string, target: { execPath: string } = process): void {
  target.execPath = provisioned
}
