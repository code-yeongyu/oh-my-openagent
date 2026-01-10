import { join } from "node:path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import type { BoulderState } from "../features/boulder-state/types"
import { readBoulderState, writeBoulderState } from "../features/boulder-state/storage"
import type { RalphLoopState } from "../hooks/ralph-loop/types"
import { readState, writeState } from "../hooks/ralph-loop/storage"
import { BOULDER_DIR } from "../features/boulder-state/constants"

export interface StateDiff {
  boulder?: Partial<BoulderState>
  ralph?: Partial<RalphLoopState>
}

export interface Snapshot {
    id: string
    timestamp: string
    boulder: BoulderState | null
    ralph: RalphLoopState | null
}

export class StateManager {
  private snapshotsDir: string

  constructor(private projectDir: string) {
    this.snapshotsDir = join(projectDir, BOULDER_DIR, "snapshots")
  }

  getBoulderState(): BoulderState | null {
    return readBoulderState(this.projectDir)
  }

  setBoulderState(state: BoulderState): boolean {
    return writeBoulderState(this.projectDir, state)
  }

  getRalphState(): RalphLoopState | null {
    return readState(this.projectDir)
  }

  setRalphState(state: RalphLoopState): boolean {
    return writeState(this.projectDir, state)
  }

  createSnapshot(id?: string): string {
    if (!existsSync(this.snapshotsDir)) {
      mkdirSync(this.snapshotsDir, { recursive: true })
    }

    const snapshotId = id || `snap-${Date.now()}`
    const snapshotPath = join(this.snapshotsDir, `${snapshotId}.json`)

    const snapshot: Snapshot = {
        id: snapshotId,
        timestamp: new Date().toISOString(),
        boulder: this.getBoulderState(),
        ralph: this.getRalphState()
    }

    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
    return snapshotId
  }

  restoreSnapshot(id: string): boolean {
    const snapshotPath = join(this.snapshotsDir, `${id}.json`)
    if (!existsSync(snapshotPath)) return false

    try {
        const content = readFileSync(snapshotPath, "utf-8")
        const snapshot = JSON.parse(content) as Snapshot

        if (snapshot.boulder) {
            this.setBoulderState(snapshot.boulder)
        }
        if (snapshot.ralph) {
            this.setRalphState(snapshot.ralph)
        }
        return true
    } catch {
        return false
    }
  }

  getDiff(snapshotId: string): StateDiff {
    const snapshotPath = join(this.snapshotsDir, `${snapshotId}.json`)
    if (!existsSync(snapshotPath)) return {}

    try {
        const content = readFileSync(snapshotPath, "utf-8")
        const snapshot = JSON.parse(content) as Snapshot
        
        const currentBoulder = this.getBoulderState()
        const currentRalph = this.getRalphState()

        const diff: StateDiff = {}

        if (JSON.stringify(currentBoulder) !== JSON.stringify(snapshot.boulder)) {
             diff.boulder = currentBoulder || undefined
        }

        if (JSON.stringify(currentRalph) !== JSON.stringify(snapshot.ralph)) {
            diff.ralph = currentRalph || undefined
        }

        return diff
    } catch {
        return {}
    }
  }
}
