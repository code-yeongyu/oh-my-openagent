import { describe, expect, test } from "bun:test"
import { grant, memorySecrets, privateKeys } from "./test-support"

describe("persistent credential identity generations", () => {
  for (const transition of ["device", "signing", "sealing", "aba", "clear-reinstall", "refresh"] as const) {
    test(`tracks ${transition} across independent credential store instances`, async () => {
      const memory = memorySecrets()
      const first = memory.store("https://api.example.test")
      const second = memory.store("https://api.example.test")
      const original = { ...grant, ...privateKeys }
      await first.write(original)
      const captured = await first.read()
      expect(captured).toHaveProperty("credentialGeneration")
      const generation = Reflect.get(captured ?? {}, "credentialGeneration")
      switch (transition) {
        case "device": await second.write({ ...original, device: { ...original.device, id: "second" } }); break
        case "signing": await second.write({ ...original, signingPrivateKey: "second-signing" }); break
        case "sealing": await second.write({ ...original, sealingPrivateKey: "second-sealing" }); break
        case "aba":
          await second.write({ ...original, device: { ...original.device, id: "second" } })
          await second.write(captured ?? original)
          break
        case "clear-reinstall":
          await second.clear()
          await second.write(captured ?? original)
          break
        case "refresh": await second.write({ ...original, accessToken: "rotated", refreshToken: "rotated-refresh" }); break
      }
      const after = Reflect.get(await first.read() ?? {}, "credentialGeneration")
      if (transition === "refresh") expect(after).toBe(generation)
      else expect(after).not.toBe(generation)
      expect(typeof after).toBe("string")
    })
  }
})
