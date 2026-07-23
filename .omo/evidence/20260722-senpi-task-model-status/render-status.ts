import { createTaskChildPlanner, type TaskModelRegistry } from "../../../packages/omo-senpi/src/components/task/planner"
import { renderTaskResultComponent } from "../../../packages/senpi-task/src/tools/task/renderers"

const model = {
  provider: "openai",
  id: "gpt-5.6-sol",
  name: "GPT-5.6 Sol",
}

const registry: TaskModelRegistry = {
  getAvailable: () => [model],
  find: (provider, modelId) => provider === model.provider && modelId === model.id ? model : undefined,
}

const planner = createTaskChildPlanner(
  {
    categories: {
      ultrabrain: {
        model: "openai/gpt-5.6-sol",
        variant: "xhigh",
        reasoningEffort: "xhigh",
      },
    },
  },
  {},
  () => registry,
)

const resolution = planner({
  prompt: "Prove the rendered category status.",
  parent_session_id: "qa-parent",
  depth: 0,
  category: "ultrabrain",
})

if (resolution.kind !== "resolved") {
  throw new Error(`Expected resolved task plan, got ${resolution.kind}`)
}

const component = renderTaskResultComponent(
  {
    task_id: "st_qa",
    status: "pending",
    mode: "spawn",
    category: resolution.plan.category,
    model: resolution.plan.model,
    resolved_model: resolution.plan.resolved_model,
    run_in_background: true,
  },
  {
    fg: (_color, text) => text,
    italic: (text) => text,
  },
)

const [row = ""] = component.render(72)
const expected = "task category:ultrabrain (openai GPT-5.6 Sol xhigh) background pending"
if (row !== expected) {
  throw new Error(`Unexpected task status:\nexpected: ${expected}\nreceived: ${row}`)
}

console.log(row)
console.log("PASS provider=openai model=GPT-5.6 Sol reasoning=xhigh width=72")
