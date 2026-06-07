import { describe, expect, test } from "bun:test"
import { spawn as nodeSpawn } from "node:child_process"

import { wrapNodeProcess } from "./spawn-with-windows-hide"

describe("spawn-with-windows-hide", () => {
  test("#given node child kill throws an Error #when wrapped kill is called #then the fallback is silent", () => {
    const proc = nodeSpawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    })
    const originalKill = proc.kill.bind(proc)

    try {
      const wrapped = wrapNodeProcess(proc)
      proc.kill = () => {
        throw new Error("kill failed")
      }

      expect(() => wrapped.kill()).not.toThrow()
    } finally {
      originalKill("SIGKILL")
    }
  })

  test("#given node child kill throws a non-Error #when wrapped kill is called #then legacy fallback stays silent", () => {
    const proc = nodeSpawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    })
    const originalKill = proc.kill.bind(proc)

    try {
      const wrapped = wrapNodeProcess(proc)
      proc.kill = () => {
        throw Object.create(null)
      }

      expect(() => wrapped.kill()).not.toThrow()
    } finally {
      originalKill("SIGKILL")
    }
  })
})
