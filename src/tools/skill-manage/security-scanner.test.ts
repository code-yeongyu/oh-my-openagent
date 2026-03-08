import { describe, expect, it } from "bun:test"
import { scanSkillContent } from "./security-scanner"

describe("security scanner", () => {
  describe("#given hard-block secret patterns", () => {
    const blockedCases = [
      "-----BEGIN PRIVATE KEY-----",
      "AKIA1234567890ABCDEF",
      '{"type":"service_account"}',
      "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=abc",
      "ghp_abcdefghijklmnopqrstuvwxyz1234567890AB",
      "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv",
      'token = "abcdefghijklmnopqrstuvwxyz1234567890"',
    ]

    for (const value of blockedCases) {
      it(`#when scanning ${value} #then blocks`, () => {
        const result = scanSkillContent(value)
        expect(result.blockedReasons.length).toBeGreaterThan(0)
      })
    }
  })

  describe("#given warning patterns", () => {
    const warningCases = [
      "eval(userInput)",
      "exec(command)",
      "subprocess.run('ls')",
      "os.system('rm -rf /')",
      "shell=True",
      "echo ${HOME}",
      "echo $(whoami)",
      "fetch https://example.com/data",
    ]

    for (const value of warningCases) {
      it(`#when scanning ${value} #then warns`, () => {
        const result = scanSkillContent(value)
        expect(result.blockedReasons).toEqual([])
        expect(result.warnings.length).toBeGreaterThan(0)
      })
    }
  })
})
