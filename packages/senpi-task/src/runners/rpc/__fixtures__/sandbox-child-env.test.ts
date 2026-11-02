import { describe, expect, test } from "bun:test"

import { SANDBOX_PLATFORM_KEYS, SANDBOX_PROFILE_KEYS, buildSandboxChildEnv } from "./sandbox-child-env"

const SANDBOX = "/sandbox/home"

describe("sandbox child environment", () => {
  test("#given a parent whose profile and temp dirs are the real user's #when the child env is built #then every profile-shaped key points into the sandbox", () => {
    const parent = { HOME: "/Users/real", USERPROFILE: "C:\\Users\\real", TMPDIR: "/tmp/real", TMP: "C:\\Temp", TEMP: "C:\\Temp", APPDATA: "C:\\Users\\real\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\real\\AppData\\Local", XDG_DATA_HOME: "/Users/real/.local/share", XDG_CACHE_HOME: "/Users/real/.cache", XDG_CONFIG_HOME: "/Users/real/.config" }
    const env = buildSandboxChildEnv({ parent, home: SANDBOX })
    for (const key of SANDBOX_PROFILE_KEYS) {
      expect({ key, value: env[key] }).toEqual({ key, value: SANDBOX })
    }
    expect(Object.values(env)).not.toContain("/Users/real")
    expect(Object.values(env)).not.toContain("C:\\Users\\real")
  })

  test("#given a parent that carries the platform keys windows resolves its own paths through #when the child env is built #then they reach the child unchanged", () => {
    const parent = { PATH: "/usr/bin", SystemRoot: "C:\\Windows", windir: "C:\\Windows", ComSpec: "C:\\Windows\\system32\\cmd.exe", PATHEXT: ".COM;.EXE;.BAT", NUMBER_OF_PROCESSORS: "4", PROCESSOR_ARCHITECTURE: "AMD64", PROCESSOR_IDENTIFIER: "Intel64 Family 6", OS: "Windows_NT" }
    const env = buildSandboxChildEnv({ parent, home: SANDBOX })
    for (const key of SANDBOX_PLATFORM_KEYS) {
      expect({ key, value: env[key] }).toEqual({ key, value: parent[key] })
    }
  })

  test("#given a parent carrying a key the sandbox does not own #when the child env is built #then it never reaches the child", () => {
    const env = buildSandboxChildEnv({ parent: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-unrelated", OMO_PACKAGE_DIR: "/real/pkg", SENPI_CODING_AGENT_DIR: "/real/agent" }, home: SANDBOX })
    expect(Object.keys(env).sort()).toEqual(["PATH", ...SANDBOX_PROFILE_KEYS].sort())
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined()
    expect(env["OMO_PACKAGE_DIR"]).toBeUndefined()
    expect(env["SENPI_CODING_AGENT_DIR"]).toBeUndefined()
  })

  test("#given a parent missing a platform key #when the child env is built #then the key is not invented", () => {
    const env = buildSandboxChildEnv({ parent: { PATH: "/usr/bin", SystemRoot: "" }, home: SANDBOX })
    expect("SystemRoot" in env).toBe(false)
    expect("windir" in env).toBe(false)
    expect(env["PATH"]).toBe("/usr/bin")
  })
})
