import { spyOn } from "bun:test"
import * as fs from "node:fs"
import { materializeProvisionedExecutable } from "../../compile-runtime"

const [source, destination] = process.argv.slice(2)
if (!source || !destination) throw new Error("expected source and destination")
const copyFile = fs.copyFileSync
spyOn(fs, "copyFileSync").mockImplementation((from, to, flags) => {
  copyFile(from, to, flags)
  fs.writeSync(1, "PROVISION_READY\n")
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
})
materializeProvisionedExecutable(source, destination, "linux")
