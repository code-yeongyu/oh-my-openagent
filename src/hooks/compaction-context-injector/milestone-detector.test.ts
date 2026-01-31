import { describe, it, expect, beforeEach } from "bun:test"
import { detectMilestone, createMilestoneDetector } from "./milestone-detector"

describe("milestone-detector", () => {
  describe("detectMilestone", () => {
    it("#then should detect 'done' keyword as completion", () => {
      //#given
      const text = "The task is done"

      //#when
      const result = detectMilestone(text)

      //#then
      expect(result.detected).toBe(true)
      expect(result.type).toBe("completion")
      expect(result.keyword).toBe("done")
    })

    it("#then should detect '完成' keyword as completion", () => {
      //#given
      const text = "任务已经完成了"

      //#when
      const result = detectMilestone(text)

      //#then
      expect(result.detected).toBe(true)
      expect(result.type).toBe("completion")
      expect(result.keyword).toBe("完成")
    })

    it("#then should detect 'finished' keyword as completion", () => {
      //#given
      const text = "I've finished the implementation"

      //#when
      const result = detectMilestone(text)

      //#then
      expect(result.detected).toBe(true)
      expect(result.type).toBe("completion")
      expect(result.keyword).toBe("finished")
    })

    it("#then should detect 'completed' keyword as completion", () => {
      //#given
      const text = "Task completed successfully"

      //#when
      const result = detectMilestone(text)

      //#then
      expect(result.detected).toBe(true)
      expect(result.type).toBe("completion")
      expect(result.keyword).toBe("completed")
    })

    it("#then should detect 'Phase 1 完成' as phase transition", () => {
      //#given
      const text = "Phase 1 完成，准备进入下一阶段"

      //#when
      const result = detectMilestone(text)

      //#then
      expect(result.detected).toBe(true)
      expect(result.type).toBe("phase-transition")
      expect(result.phase).toBe("1")
    })

    it("#then should detect 'Phase 2 done' as phase transition", () => {
      //#given
      const text = "Phase 2 done, moving to Phase 3"

      //#when
      const result = detectMilestone(text)

      //#then
      expect(result.detected).toBe(true)
      expect(result.type).toBe("phase-transition")
      expect(result.phase).toBe("2")
    })

    it("#then should detect 'phase complete' as phase transition", () => {
      //#given
      const text = "Current phase complete"

      //#when
      const result = detectMilestone(text)

      //#then
      expect(result.detected).toBe(true)
      expect(result.type).toBe("phase-transition")
    })

    it("#then should return none for regular text without keywords", () => {
      //#given
      const text = "Working on the implementation"

      //#when
      const result = detectMilestone(text)

      //#then
      expect(result.detected).toBe(false)
      expect(result.type).toBe("none")
      expect(result.keyword).toBeUndefined()
    })

    it("#then should be case-insensitive for English keywords", () => {
      //#given
      const text = "DONE with this task"

      //#when
      const result = detectMilestone(text)

      //#then
      expect(result.detected).toBe(true)
      expect(result.type).toBe("completion")
    })
  })

  describe("createMilestoneDetector", () => {
    let detector: ReturnType<typeof createMilestoneDetector>

    beforeEach(() => {
      //#given - fresh detector for each test
      detector = createMilestoneDetector()
    })

    it("#then should suggest compaction on first milestone detection", () => {
      //#given
      const sessionId = "session-1"
      const text = "Task is done"

      //#when
      const suggestion = detector.shouldSuggestCompaction(sessionId, text)

      //#then
      expect(suggestion.shouldSuggest).toBe(true)
      expect(suggestion.milestone?.detected).toBe(true)
      expect(suggestion.reason).toBeDefined()
    })

    it("#then should not suggest compaction after user rejection", () => {
      //#given
      const sessionId = "session-2"
      const text = "Task is done"

      //#when
      detector.markRejected(sessionId)
      const suggestion = detector.shouldSuggestCompaction(sessionId, text)

      //#then
      expect(suggestion.shouldSuggest).toBe(false)
    })

    it("#then should respect max 3 suggestions limit per session", () => {
      //#given
      const sessionId = "session-3"
      const texts = ["Task 1 done", "Task 2 done", "Task 3 done", "Task 4 done"]

      //#when - trigger 4 milestones
      const suggestions = texts.map(text => 
        detector.shouldSuggestCompaction(sessionId, text)
      )

      //#then - only first 3 should suggest
      expect(suggestions[0].shouldSuggest).toBe(true)
      expect(suggestions[1].shouldSuggest).toBe(true)
      expect(suggestions[2].shouldSuggest).toBe(true)
      expect(suggestions[3].shouldSuggest).toBe(false)
    })

    it("#then should not suggest for text without milestones", () => {
      //#given
      const sessionId = "session-4"
      const text = "Still working on it"

      //#when
      const suggestion = detector.shouldSuggestCompaction(sessionId, text)

      //#then
      expect(suggestion.shouldSuggest).toBe(false)
      expect(suggestion.milestone?.detected).toBe(false)
    })

    it("#then should reset session state when resetSession is called", () => {
      //#given
      const sessionId = "session-5"
      detector.markRejected(sessionId)

      //#when
      detector.resetSession(sessionId)
      const suggestion = detector.shouldSuggestCompaction(sessionId, "Task done")

      //#then
      expect(suggestion.shouldSuggest).toBe(true)
    })

    it("#then should track different sessions independently", () => {
      //#given
      const session1 = "session-6"
      const session2 = "session-7"

      //#when
      detector.markRejected(session1)
      const suggestion1 = detector.shouldSuggestCompaction(session1, "Task done")
      const suggestion2 = detector.shouldSuggestCompaction(session2, "Task done")

      //#then
      expect(suggestion1.shouldSuggest).toBe(false)
      expect(suggestion2.shouldSuggest).toBe(true)
    })

    it("#then should include milestone info in suggestion when detected", () => {
      //#given
      const sessionId = "session-8"
      const text = "Phase 1 完成"

      //#when
      const suggestion = detector.shouldSuggestCompaction(sessionId, text)

      //#then
      expect(suggestion.shouldSuggest).toBe(true)
      expect(suggestion.milestone?.type).toBe("phase-transition")
      expect(suggestion.milestone?.phase).toBe("1")
    })
  })
})
