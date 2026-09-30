import { describe, expect, test } from "bun:test"
import { adoptProvisionedExecPath } from "../provisioned-exec-path"

describe("adoptProvisionedExecPath", () => {
  test("#given a process running from its download folder #when the runtime is provisioned in-process #then execPath names the provisioned executable", () => {
    const processLike = { execPath: "C:\\Users\\u\\Downloads\\omo-windows-x64.exe" }
    adoptProvisionedExecPath("C:\\Users\\u\\.omo\\binary-runtime\\5.1.4\\omo.exe", processLike)
    expect(processLike.execPath).toBe("C:\\Users\\u\\.omo\\binary-runtime\\5.1.4\\omo.exe")
  })
})
