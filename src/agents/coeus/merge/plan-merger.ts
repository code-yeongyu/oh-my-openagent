import type { SubPlan, Task } from "../schemas/sub-plan-schema"
import type { MergedPlan } from "../schemas/merged-plan-schema"

function namespaceTask(domain: string, task: Task): Task {
  return {
    ...task,
    id: `${domain}-${task.id}`,
    depends_on: task.depends_on.map((dep) => `${domain}-${dep}`),
  }
}

function detectCrossplanDeps(
  namespacedTasks: Task[],
  domainOrder: Map<string, number>
): Map<string, string[]> {
  const fileOwners = new Map<string, string[]>()

  for (const task of namespacedTasks) {
    for (const file of task.files_touched) {
      const owners = fileOwners.get(file) ?? []
      owners.push(task.id)
      fileOwners.set(file, owners)
    }
  }

  const extraDeps = new Map<string, string[]>()

  for (const [, owners] of fileOwners) {
    if (owners.length < 2) continue

    const sorted = [...owners].sort((a, b) => {
      const domainA = a.substring(0, a.lastIndexOf("-"))
      const domainB = b.substring(0, b.lastIndexOf("-"))
      return (domainOrder.get(domainA) ?? 0) - (domainOrder.get(domainB) ?? 0)
    })

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i]
      const prior = sorted[i - 1]
      const deps = extraDeps.get(current) ?? []
      if (!deps.includes(prior)) deps.push(prior)
      extraDeps.set(current, deps)
    }
  }

  return extraDeps
}

function assignWaves(tasks: Task[]): MergedPlan["waves"] {
  const inDegree = new Map<string, number>()
  const adjList = new Map<string, string[]>()

  for (const task of tasks) {
    inDegree.set(task.id, task.depends_on.length)
    for (const dep of task.depends_on) {
      const list = adjList.get(dep) ?? []
      list.push(task.id)
      adjList.set(dep, list)
    }
  }

  const waves: MergedPlan["waves"] = []
  const remaining = new Set(tasks.map((t) => t.id))

  let waveNum = 1
  while (remaining.size > 0) {
    const ready: string[] = []
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) ready.push(id)
    }

    if (ready.length === 0) break

    ready.sort()
    waves.push({ wave: waveNum, task_ids: ready })

    for (const id of ready) {
      remaining.delete(id)
      for (const dependent of adjList.get(id) ?? []) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 1) - 1)
      }
    }
    waveNum++
  }

  return waves
}

function buildDependencyGraph(tasks: Task[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {}
  for (const task of tasks) {
    graph[task.id] = [...task.depends_on]
  }
  return graph
}

export function mergeSubPlans(subPlans: SubPlan[], globalConstraints: string): MergedPlan {
  if (subPlans.length === 0) {
    return {
      title: "Merged Plan",
      context: globalConstraints,
      domains: [],
      tasks: [],
      waves: [],
      dependency_graph: {},
      global_constraints: globalConstraints,
    }
  }

  const domains = subPlans.map((p) => p.domain)
  const domainOrder = new Map(domains.map((d, i) => [d, i]))

  const namespacedTasks: Task[] = subPlans.flatMap((plan) =>
    plan.tasks.map((task) => namespaceTask(plan.domain, task))
  )

  const crossDeps = detectCrossplanDeps(namespacedTasks, domainOrder)
  for (const [taskId, deps] of crossDeps) {
    const task = namespacedTasks.find((t) => t.id === taskId)
    if (task) {
      for (const dep of deps) {
        if (!task.depends_on.includes(dep)) task.depends_on.push(dep)
      }
    }
  }

  const waves = assignWaves(namespacedTasks)
  const dependency_graph = buildDependencyGraph(namespacedTasks)

  return {
    title: `Merged Plan: ${domains.join(", ")}`,
    context: globalConstraints,
    domains,
    tasks: namespacedTasks,
    waves,
    dependency_graph,
    global_constraints: globalConstraints,
  }
}
