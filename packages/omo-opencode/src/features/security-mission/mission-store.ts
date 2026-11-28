import { join } from "node:path"
import type {
  AddFindingInput,
  CreateMissionInput,
  Finding,
  Mission,
} from "./types"
import { MissionSchema } from "./types"
import { gateFinding } from "./finding-gate"
import { scopeViolation } from "./scope-guard"
import {
  generateFindingId,
  generateMissionId,
  readJsonFile,
  writeJsonAtomic,
} from "./storage"

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class MissionStore {
  private readonly missions: Map<string, Mission> = new Map()
  private readonly persistenceDir: string | undefined
  private readonly maxFindings: number
  private readonly now: () => string

  constructor(args: {
    readonly persistenceDir?: string
    readonly maxFindings?: number
    readonly now?: () => string
  }) {
    this.persistenceDir = args.persistenceDir
    this.maxFindings = args.maxFindings ?? 500
    this.now = args.now ?? (() => new Date().toISOString())
  }

  createMission(input: CreateMissionInput): Mission {
    const mission: Mission = {
      id: generateMissionId(),
      name: input.name,
      objective: input.objective,
      scope: {
        allowed_hosts: input.scope?.allowed_hosts ?? [],
        allowed_paths: input.scope?.allowed_paths ?? [],
        allow_loopback: input.scope?.allow_loopback ?? false,
        allow_private: input.scope?.allow_private ?? false,
      },
      status: "scoped",
      created_at: this.now(),
      findings: [],
    }
    this.missions.set(mission.id, mission)
    this.persist(mission)
    return clone(mission)
  }

  getMission(missionId: string): Mission | undefined {
    const cached = this.missions.get(missionId)
    if (cached) return clone(cached)
    const loaded = this.loadFromDisk(missionId)
    if (loaded) {
      this.missions.set(missionId, loaded)
      return clone(loaded)
    }
    return undefined
  }

  addFinding(input: AddFindingInput): Finding {
    const mission = this.getMutableMission(input.mission_id)
    if (!mission) throw new Error(`mission ${input.mission_id} not found`)
    if (mission.status === "completed") {
      throw new Error(`mission ${input.mission_id} is completed`)
    }
    if (mission.findings.length >= this.maxFindings) {
      throw new Error(`max_findings (${this.maxFindings}) reached`)
    }

    if (input.target_id) {
      const violation = scopeViolation(mission.scope, input.target_id)
      if (violation) {
        throw new Error(`target_id scope violation: ${violation}`)
      }
    }

    const gate = gateFinding({
      severity: input.severity,
      evidence: input.evidence,
      now: this.now,
    })

    const finding: Finding = {
      id: generateFindingId(),
      title: input.title,
      description: input.description,
      severity: input.severity,
      cwe: input.cwe,
      cvss_vector: input.cvss_vector,
      evidence: input.evidence,
      evidence_level: gate.provenance === "tool" ? "source-verified" : "claimed",
      remediation: input.remediation,
      references: input.references,
      target_id: input.target_id,
      discovered_at: this.now(),
      verified_at: gate.passed ? this.now() : undefined,
      status: gate.passed ? "verified" : "claimed",
      verify_gate: gate,
    }

    mission.findings.push(finding)
    if (mission.status === "scoped") mission.status = "active"
    this.persist(mission)
    return clone(finding)
  }

  verifyFinding(missionId: string, findingId: string): Finding {
    const mission = this.getMutableMission(missionId)
    if (!mission) throw new Error(`mission ${missionId} not found`)
    if (mission.status === "completed") {
      throw new Error(`mission ${missionId} is completed`)
    }
    const finding = mission.findings.find((f) => f.id === findingId)
    if (!finding) throw new Error(`finding ${findingId} not found`)

    const gate = gateFinding({
      severity: finding.severity,
      evidence: finding.evidence,
      now: this.now,
    })
    finding.verify_gate = gate
    if (gate.passed) {
      finding.verified_at = this.now()
      finding.status = "verified"
      finding.evidence_level = "source-verified"
    }
    this.persist(mission)
    return clone(finding)
  }

  listMissions(): Mission[] {
    return [...this.missions.values()].map(clone)
  }

  completeMission(missionId: string): Mission {
    const mission = this.getMutableMission(missionId)
    if (!mission) throw new Error(`mission ${missionId} not found`)
    mission.status = "completed"
    mission.completed_at = this.now()
    this.persist(mission)
    return clone(mission)
  }

  private getMutableMission(missionId: string): Mission | undefined {
    const cached = this.missions.get(missionId)
    if (cached) return cached
    const loaded = this.loadFromDisk(missionId)
    if (loaded) {
      this.missions.set(missionId, loaded)
      return loaded
    }
    return undefined
  }

  private persist(mission: Mission): void {
    if (!this.persistenceDir) return
    const filePath = join(this.persistenceDir, `${mission.id}.json`)
    writeJsonAtomic(filePath, mission)
  }

  private loadFromDisk(missionId: string): Mission | undefined {
    if (!this.persistenceDir) return undefined
    const filePath = join(this.persistenceDir, `${missionId}.json`)
    const raw = readJsonFile<unknown>(filePath)
    if (!raw) return undefined
    const parsed = MissionSchema.safeParse(raw)
    return parsed.success ? parsed.data : undefined
  }
}

export function createMissionStore(args: {
  readonly persistenceDir?: string
  readonly maxFindings?: number
  readonly now?: () => string
}): MissionStore {
  return new MissionStore(args)
}
