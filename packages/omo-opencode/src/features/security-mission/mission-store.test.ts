import { describe, expect, it } from "bun:test"
import { createMissionStore } from "./mission-store"
import type { AddFindingInput, CreateMissionInput } from "./types"

const fixedNow = () => "2026-01-01T00:00:00.000Z"

function makeStore() {
  return createMissionStore({ now: fixedNow })
}

function makeMissionInput(overrides?: Partial<CreateMissionInput>): CreateMissionInput {
  return {
    name: "test-mission",
    objective: "Audit target.example.com",
    scope: {
      allowed_hosts: [{ host: "target.example.com" }],
      allowed_paths: [],
      allow_loopback: false,
      allow_private: false,
    },
    ...overrides,
  }
}

function makeFindingInput(missionId: string, overrides?: Partial<AddFindingInput>): AddFindingInput {
  return {
    mission_id: missionId,
    title: "SQL Injection",
    description: "Unsanitized input in login form",
    severity: "high",
    evidence: [{ kind: "output", content: "error: SQL syntax" }],
    ...overrides,
  }
}

describe("MissionStore", () => {
  describe("createMission", () => {
    it("#given valid input -> #when create -> #then returns mission with id and scoped status", () => {
      // given
      const store = makeStore()

      // when
      const mission = store.createMission(makeMissionInput())

      // then
      expect(mission.id).toMatch(/^sec-/)
      expect(mission.name).toBe("test-mission")
      expect(mission.status).toBe("scoped")
      expect(mission.findings).toEqual([])
      expect(mission.scope.allowed_hosts).toHaveLength(1)
    })
  })

  describe("getMission", () => {
    it("#given existing mission -> #when get -> #then returns mission", () => {
      // given
      const store = makeStore()
      const created = store.createMission(makeMissionInput())

      // when
      const retrieved = store.getMission(created.id)

      // then
      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(created.id)
    })

    it("#given non-existent mission -> #when get -> #then returns undefined", () => {
      // given
      const store = makeStore()

      // when
      const result = store.getMission("nonexistent")

      // then
      expect(result).toBeUndefined()
    })
  })

  describe("addFinding", () => {
    it("#given tool-backed evidence -> #when add -> #then finding is verified", () => {
      // given
      const store = makeStore()
      const mission = store.createMission(makeMissionInput())

      // when
      const finding = store.addFinding(makeFindingInput(mission.id))

      // then
      expect(finding.status).toBe("verified")
      expect(finding.verified_at).toBeDefined()
      expect(finding.verify_gate?.passed).toBe(true)
      expect(finding.evidence_level).toBe("source-verified")
    })

    it("#given no evidence -> #when add -> #then finding is claimed but not verified", () => {
      // given
      const store = makeStore()
      const mission = store.createMission(makeMissionInput())

      // when
      const finding = store.addFinding(
        makeFindingInput(mission.id, {
          evidence: [],
          severity: "info",
        }),
      )

      // then
      expect(finding.status).toBe("claimed")
      expect(finding.verified_at).toBeUndefined()
      expect(finding.verify_gate?.passed).toBe(false)
      expect(finding.evidence_level).toBe("claimed")
    })

    it("#given mission transitions to active after first finding", () => {
      // given
      const store = makeStore()
      const mission = store.createMission(makeMissionInput())

      // when
      store.addFinding(makeFindingInput(mission.id))
      const updated = store.getMission(mission.id)

      // then
      expect(updated?.status).toBe("active")
    })

    it("#given non-existent mission -> #when add -> #then throws", () => {
      // given
      const store = makeStore()

      // when / then
      expect(() => store.addFinding(makeFindingInput("nonexistent"))).toThrow(
        "mission nonexistent not found",
      )
    })

    it("#given max_findings reached -> #when add -> #then throws", () => {
      // given
      const store = createMissionStore({ maxFindings: 1, now: fixedNow })
      const mission = store.createMission(makeMissionInput())
      store.addFinding(makeFindingInput(mission.id, { severity: "info", evidence: [{ kind: "log", content: "x" }] }))

      // when / then
      expect(() => store.addFinding(makeFindingInput(mission.id, { title: "second" }))).toThrow(
        "max_findings",
      )
    })

    it("#given completed mission -> #when add -> #then throws", () => {
      // given
      const store = makeStore()
      const mission = store.createMission(makeMissionInput())
      store.completeMission(mission.id)

      // when / then
      expect(() => store.addFinding(makeFindingInput(mission.id))).toThrow(
        "is completed",
      )
    })

    it("#given target_id outside scope -> #when add -> #then throws scope violation", () => {
      // given
      const store = makeStore()
      const mission = store.createMission(makeMissionInput())

      // when / then
      expect(() =>
        store.addFinding(makeFindingInput(mission.id, { target_id: "evil.example.com" })),
      ).toThrow("scope violation")
    })

    it("#given target_id inside scope -> #when add -> #then accepts finding", () => {
      // given
      const store = makeStore()
      const mission = store.createMission(makeMissionInput())

      // when
      const finding = store.addFinding(
        makeFindingInput(mission.id, { target_id: "target.example.com" }),
      )

      // then
      expect(finding.target_id).toBe("target.example.com")
    })
  })

  describe("verifyFinding", () => {
    it("#given claimed finding -> #when verify with no new evidence -> #then stays unverified", () => {
      // given
      const store = makeStore()
      const mission = store.createMission(makeMissionInput())
      const finding = store.addFinding(
        makeFindingInput(mission.id, {
          evidence: [],
          severity: "info",
        }),
      )

      // when
      const updated = store.verifyFinding(mission.id, finding.id)

      // then
      expect(updated.status).toBe("claimed")
      expect(updated.verify_gate?.passed).toBe(false)
    })
  })

  describe("completeMission", () => {
    it("#given active mission -> #when complete -> #then status is completed", () => {
      // given
      const store = makeStore()
      const mission = store.createMission(makeMissionInput())

      // when
      const completed = store.completeMission(mission.id)

      // then
      expect(completed.status).toBe("completed")
      expect(completed.completed_at).toBeDefined()
    })

    it("#given completed mission -> #when verify finding -> #then throws", () => {
      // given
      const store = makeStore()
      const mission = store.createMission(makeMissionInput())
      const finding = store.addFinding(makeFindingInput(mission.id))
      store.completeMission(mission.id)

      // when / then
      expect(() => store.verifyFinding(mission.id, finding.id)).toThrow("is completed")
    })
  })

  describe("listMissions", () => {
    it("#given multiple missions -> #when list -> #then returns all", () => {
      // given
      const store = makeStore()
      store.createMission(makeMissionInput({ name: "mission-1" }))
      store.createMission(makeMissionInput({ name: "mission-2" }))

      // when
      const list = store.listMissions()

      // then
      expect(list).toHaveLength(2)
    })
  })

  describe("defensive copies", () => {
    it("#given mission from getMission -> #when mutate returned object -> #then internal state unchanged", () => {
      // given
      const store = makeStore()
      const mission = store.createMission(makeMissionInput())

      // when
      const retrieved = store.getMission(mission.id)
      retrieved?.findings.push({
        id: "fake",
        title: "fake",
        description: "fake",
        severity: "info",
        evidence: [],
        evidence_level: "claimed",
        references: [],
        discovered_at: fixedNow(),
        status: "claimed",
      })

      // then
      const again = store.getMission(mission.id)
      expect(again?.findings).toHaveLength(0)
    })
  })
})
