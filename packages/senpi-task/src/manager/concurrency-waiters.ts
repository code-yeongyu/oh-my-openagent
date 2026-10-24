export type QueuedTaskAdmission = {
  readonly model: string
  readonly laneKey: string
  readonly taskId: string
  readonly runEpoch: number
  readonly sequence: number
}

export type TaskWaiter = QueuedTaskAdmission & { readonly grant: () => void }

export class TaskWaitQueue extends Map<string, TaskWaiter[]> {
  #sequence = 0

  reserveSequence(): number { return this.#sequence++ }

  enqueue(input: Omit<TaskWaiter, "sequence"> & { readonly sequence?: number }): number {
    const sequence = input.sequence ?? this.reserveSequence()
    this.#sequence = Math.max(this.#sequence, sequence + 1)
    const queue = this.get(input.laneKey) ?? []
    queue.push({ ...input, sequence })
    if (input.sequence !== undefined) queue.sort((a, b) => a.sequence - b.sequence)
    this.set(input.laneKey, queue)
    return queue.findIndex(waiter => waiter.taskId === input.taskId && waiter.runEpoch === input.runEpoch) + 1
  }

  position(laneKey: string, taskId: string): number | undefined {
    const index = this.get(laneKey)?.findIndex(waiter => waiter.taskId === taskId)
    return index === undefined || index === -1 ? undefined : index + 1
  }

  take(laneKey: string, taskId: string, runEpoch?: number): QueuedTaskAdmission | undefined {
    const queue = this.get(laneKey)
    const index = queue?.findIndex(waiter => waiter.taskId === taskId && (runEpoch === undefined || waiter.runEpoch === runEpoch))
    if (queue === undefined || index === undefined || index === -1) return undefined
    const [waiter] = queue.splice(index, 1)
    if (queue.length === 0) this.delete(laneKey)
    if (waiter === undefined) throw new Error("queued admission vanished")
    const { grant: _grant, ...admission } = waiter
    return admission
  }

  admission(taskId: string, runEpoch: number): QueuedTaskAdmission | undefined {
    for (const queue of this.values()) {
      const waiter = queue.find(entry => entry.taskId === taskId && entry.runEpoch === runEpoch)
      if (waiter === undefined) continue
      const { grant: _grant, ...admission } = waiter
      return admission
    }
    return undefined
  }
}
