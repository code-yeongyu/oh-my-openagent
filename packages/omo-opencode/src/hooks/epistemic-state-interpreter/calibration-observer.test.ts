import { afterEach, describe, expect, it, spyOn } from "bun:test"
import * as loggerModule from "../../shared/logger"

import { _resetCalibrationForTesting, clearCalibration, observeCalibration } from "./calibration-observer"

afterEach(() => {
  _resetCalibrationForTesting()
})

describe("calibration-observer", () => {
  describe("#given a session with observations #when observeCalibration called #then increments counter correctly", () => {
    it("tracks observation count per state", () => {
      const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true)
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      observeCalibration("s1", "accepted")
      observeCalibration("s1", "accepted")
      observeCalibration("s1", "plausible")

      for (let i = 0; i < 97; i++) observeCalibration("s1", "accepted")

      expect(logSpy).toHaveBeenCalled()
      expect(stderrSpy).not.toHaveBeenCalled()
      stderrSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe("#given fewer than 100 observations #when threshold not reached #then no suggestion emitted", () => {
    it("does not emit stderr below 100 observations", () => {
      const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true)
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      for (let i = 0; i < 99; i++) observeCalibration("s2", "accepted")

      expect(logSpy).not.toHaveBeenCalled()
      expect(stderrSpy).not.toHaveBeenCalled()
      stderrSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe("#given state at >80% frequency #when 100+ observations reached #then suggestion emitted for high frequency", () => {
    it("emits stderr when state exceeds 80% frequency", () => {
      const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true)
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      for (let i = 0; i < 90; i++) observeCalibration("s3", "accepted")
      for (let i = 0; i < 10; i++) observeCalibration("s3", "plausible")

      expect(logSpy).toHaveBeenCalled()
      expect(stderrSpy).not.toHaveBeenCalled()
      const output = String(logSpy.mock.calls[0][0])
      expect(output).toContain(">80%")
      stderrSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe("#given state at <5% frequency #when 100+ observations reached #then suggestion emitted for low frequency", () => {
    it("emits stderr when state below 5% frequency", () => {
      const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true)
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      for (let i = 0; i < 98; i++) observeCalibration("s4", "accepted")
      observeCalibration("s4", "plausible")
      observeCalibration("s4", "open")

      expect(logSpy).toHaveBeenCalled()
      expect(stderrSpy).not.toHaveBeenCalled()
      const calls = logSpy.mock.calls.map((c: unknown[]) => String(c[0]))
      const lowFreqCall = calls.find((c) => c.includes("<5%"))
      expect(lowFreqCall).toBeDefined()
      stderrSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe("#given an active session #when clearCalibration called #then session data removed", () => {
    it("removes session data so subsequent observations start fresh", () => {
      const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true)
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      for (let i = 0; i < 50; i++) observeCalibration("s5", "accepted")
      clearCalibration("s5")

      for (let i = 0; i < 99; i++) observeCalibration("s5", "accepted")

      expect(logSpy).not.toHaveBeenCalled()
      expect(stderrSpy).not.toHaveBeenCalled()
      stderrSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe("#given a qualifying observation #when suggestion emitted #then message includes session ID and state name", () => {
    it("includes session ID and state name in stderr message", () => {
      const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true)
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      for (let i = 0; i < 100; i++) observeCalibration("test-session-42", "accepted")

      expect(logSpy).toHaveBeenCalled()
      expect(stderrSpy).not.toHaveBeenCalled()
      const output = String(logSpy.mock.calls[0][0])
      expect(output).toContain("test-session-42")
      expect(output).toContain("accepted")
      stderrSpy.mockRestore()
      logSpy.mockRestore()
    })
  })
})
