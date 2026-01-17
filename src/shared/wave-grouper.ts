export interface TaskFiles {
  create: string[]
  modify: string[]
  test: string[]
}

export interface WaveTaskInput {
  id: string
  dependsOn?: string[]
  files?: Partial<TaskFiles>
}

export interface WaveTask {
  id: string
  dependsOn: string[]
  files: TaskFiles
}

export interface FileConflict {
  file: string
  blockingTaskId: string
  blockedTaskId: string
}

export interface Wave {
  id: number
  tasks: WaveTask[]
  worktreeBranch?: string
}

export interface WaveGrouperOptions {
  featureName?: string
  onConflict?: (conflict: FileConflict) => void
}

export interface WaveGroupingResult {
  waves: Wave[]
  conflicts: FileConflict[]
}

export function buildWaveBranchName(featureName: string, waveId: number): string {
  return `feature/${featureName}-wave${waveId}`
}

export function groupTasksIntoWaves(
  tasks: WaveTaskInput[],
  options: WaveGrouperOptions = {}
): WaveGroupingResult {
  const normalizedTasks = tasks.map(normalizeTask)
  const taskById = new Map(normalizedTasks.map((task) => [task.id, task]))
  const conflicts: FileConflict[] = []

  for (const [taskId, task] of taskById) {
    if (taskId !== task.id) {
      throw new Error(`Task id mismatch: ${taskId} != ${task.id}`)
    }
  }

  const fileToTasks = new Map<string, string[]>()

  for (const task of normalizedTasks) {
    const files = new Set([...task.files.create, ...task.files.modify])
    for (const file of files) {
      const taskIds = fileToTasks.get(file) ?? []
      taskIds.push(task.id)
      fileToTasks.set(file, taskIds)
    }
  }

  for (const [file, taskIds] of fileToTasks) {
    if (taskIds.length <= 1) {
      continue
    }

    for (let index = 1; index < taskIds.length; index += 1) {
      const blockingTaskId = taskIds[index - 1]
      const blockedTaskId = taskIds[index]
      const blockedTask = taskById.get(blockedTaskId)

      if (!blockedTask) {
        continue
      }

      if (!blockedTask.dependsOn.includes(blockingTaskId)) {
        blockedTask.dependsOn.push(blockingTaskId)
      }

      const conflict = { file, blockingTaskId, blockedTaskId }
      conflicts.push(conflict)
      options.onConflict?.(conflict)
    }
  }

  const completed = new Set<string>()
  const remaining = [...normalizedTasks]
  const waves: Wave[] = []
  let waveId = 0

  while (remaining.length > 0) {
    const ready = remaining.filter((task) =>
      task.dependsOn.every((dependency) => completed.has(dependency))
    )

    if (ready.length === 0) {
      throw new Error("Circular or unresolved dependency detected")
    }

    const wave: Wave = {
      id: waveId,
      tasks: ready,
      worktreeBranch: options.featureName
        ? buildWaveBranchName(options.featureName, waveId)
        : undefined,
    }

    waves.push(wave)

    const readyIds = new Set(ready.map((task) => task.id))
    for (const task of ready) {
      completed.add(task.id)
    }

    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (readyIds.has(remaining[index].id)) {
        remaining.splice(index, 1)
      }
    }

    waveId += 1
  }

  return { waves, conflicts }
}

function normalizeTask(task: WaveTaskInput): WaveTask {
  return {
    id: task.id,
    dependsOn: [...new Set(task.dependsOn ?? [])],
    files: {
      create: task.files?.create ?? [],
      modify: task.files?.modify ?? [],
      test: task.files?.test ?? [],
    },
  }
}
