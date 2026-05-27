import { describe, expect, test } from "bun:test"

import {
  BOULDER_DIR,
  BOULDER_FILE,
  BOULDER_STATE_PATH,
  NOTEPAD_BASE_PATH,
  NOTEPAD_DIR,
  PROMETHEUS_PLANS_DIR,
} from "./constants"

describe("constants", () => {
  describe("#given BOULDER_DIR", () => {
    test("#then it equals .omo", () => {
      expect(BOULDER_DIR).toBe(".omo")
    })

    test("#then it is a string", () => {
      expect(typeof BOULDER_DIR).toBe("string")
    })
  })

  describe("#given BOULDER_FILE", () => {
    test("#then it equals boulder.json", () => {
      expect(BOULDER_FILE).toBe("boulder.json")
    })

    test("#then it is a string", () => {
      expect(typeof BOULDER_FILE).toBe("string")
    })
  })

  describe("#given BOULDER_STATE_PATH", () => {
    test("#then it combines BOULDER_DIR and BOULDER_FILE", () => {
      expect(BOULDER_STATE_PATH).toBe(`${BOULDER_DIR}/${BOULDER_FILE}`)
    })

    test("#then it equals .omo/boulder.json", () => {
      expect(BOULDER_STATE_PATH).toBe(".omo/boulder.json")
    })
  })

  describe("#given NOTEPAD_DIR", () => {
    test("#then it equals notepads", () => {
      expect(NOTEPAD_DIR).toBe("notepads")
    })
  })

  describe("#given NOTEPAD_BASE_PATH", () => {
    test("#then it combines BOULDER_DIR and NOTEPAD_DIR", () => {
      expect(NOTEPAD_BASE_PATH).toBe(`${BOULDER_DIR}/${NOTEPAD_DIR}`)
    })

    test("#then it equals .omo/notepads", () => {
      expect(NOTEPAD_BASE_PATH).toBe(".omo/notepads")
    })
  })

  describe("#given PROMETHEUS_PLANS_DIR", () => {
    test("#then it equals .omo/plans", () => {
      expect(PROMETHEUS_PLANS_DIR).toBe(".omo/plans")
    })

    test("#then it starts with BOULDER_DIR", () => {
      expect(PROMETHEUS_PLANS_DIR.startsWith(BOULDER_DIR)).toBe(true)
    })
  })
})
