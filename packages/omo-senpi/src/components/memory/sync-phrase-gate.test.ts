import { expect, test } from "bun:test"

import { PHRASE_GENESIS_FLAG, phraseGateFrom } from "./sync-phrase-gate"

const logger = () => {
  const lines: { message: string; fields?: Record<string, unknown> }[] = []
  return {
    lines,
    error: (message: string, fields?: Record<string, unknown>) =>
      void lines.push({ message, ...(fields === undefined ? {} : { fields }) }),
  }
}

test("#given the release flag set to exactly 1 #when the host builds its phrase gate #then creation is enabled and no floor reader is wired", () => {
  const gate = phraseGateFrom({ [PHRASE_GENESIS_FLAG]: "1" }, logger())
  expect(gate.enabled).toBe(true)
  // Contract A1.1-M4.6: the shipped host never wires the service floor reader, so the floor reads unknown.
  expect(gate.serviceFloor).toBeUndefined()
})

for (const value of [undefined, "", "0", "true", "yes", " 1"]) {
  test(`#given the release flag ${value === undefined ? "absent" : JSON.stringify(value)} #when the host builds its phrase gate #then creation stays off`, () => {
    const env = value === undefined ? {} : { [PHRASE_GENESIS_FLAG]: value }
    expect(phraseGateFrom(env, logger()).enabled).toBe(false)
  })
}

test("#given a refused phrase creation #when the gate reports it #then one error line names the reason, the account and the flag, and nothing secret", () => {
  const log = logger()
  phraseGateFrom({ [PHRASE_GENESIS_FLAG]: "1" }, log).refused("service-floor-off", "account-1")
  expect(log.lines).toEqual([
    {
      message: "memory sync refused to create a recovery phrase",
      fields: { reason: "service-floor-off", account: "account-1", flag: PHRASE_GENESIS_FLAG },
    },
  ])
})
