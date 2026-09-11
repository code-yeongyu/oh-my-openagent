import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"

import { toolErrorResult, toolResult } from "../control"
import type { TeamCreateDetails, TeamDeleteDetails } from "./lifecycle"
import { fakeTask } from "./__fixtures__/team-tool-fakes"
import {
  renderTeamCreateCall,
  renderTeamCreateResult,
  renderTeamDeleteCall,
  renderTeamDeleteResult,
  renderTeamTaskCall,
  renderTeamTaskResult,
  type TeamRenderTheme,
} from "./renderers"
import type { TeamTaskGetDetails, TeamTaskListDetails, TeamTaskUpdateDetails } from "./tasks"

const TEST_THEME: TeamRenderTheme = {
  fg: (color: ThemeColor, text: string) => `[${color}]${text}[/${color}]`,
  italic: (text: string) => `<i>${text}</i>`,
}

const RESULT_OPTIONS = { expanded: false, isPartial: false }

function lines(component: { render(width: number): string[] }, width = 120): string[] {
  return component.render(width)
}

const MEMBER_START_REASON = "member 'bench-landscape' failed to start: No available model for category \"deep\" (attempted mock/model)"

describe("team tool renderers", () => {
  test("#given an inline spec with two members #when rendering the team_create call #then it reads team create name:<n> members:<N>", () => {
    const [line] = lines(renderTeamCreateCall({ inline_spec: { name: "bench", members: [{ name: "a", category: "deep" }, { name: "b", category: "quick" }] } }, TEST_THEME))
    expect(line).toContain("team create")
    expect(line).toContain("name:bench")
    expect(line).toContain("members:2")
  })

  test("#given a single-object members spec as a JSON string #when rendering the call #then it counts one member", () => {
    const spec = JSON.stringify({ name: "solo", members: { name: "only", category: "quick" } })
    const [line] = lines(renderTeamCreateCall({ inline_spec: spec }, TEST_THEME))
    expect(line).toContain("name:solo")
    expect(line).toContain("members:1")
  })

  test("#given a named spec #when rendering the call #then it reads team create spec:<team_name>", () => {
    const [line] = lines(renderTeamCreateCall({ team_name: "review-squad" }, TEST_THEME))
    expect(line).toContain("team create spec:review-squad")
  })

  test("#given a created team #when rendering the result #then the title is success-colored and each member line carries its own status color", () => {
    const details: TeamCreateDetails = {
      kind: "created",
      team_run_id: "run-1",
      team_name: "bench",
      members: [
        { name: "alpha", status: "running", role: "category:deep", task_id: "st_a", model: { provider: "anthropic", model_id: "claude-opus-4-7", display: "Claude Opus 4.7", source: "category" } },
        { name: "beta", status: "pending", role: "agent:sisyphus", task_id: "st_b" },
      ],
    }
    const rendered = lines(renderTeamCreateResult(toolResult("Created team", details), RESULT_OPTIONS, TEST_THEME))

    expect(rendered[0]).toBe("[success]team created 'bench' run:run-1 members:2[/success]")
    expect(rendered[1]).toBe("[accent]- alpha [running] category:deep(anthropic/claude-opus-4-7) task:st_a[/accent]")
    expect(rendered[2]).toBe("[muted]- beta [pending] agent:sisyphus task:st_b[/muted]")
  })

  test("#given a member start rejection #when rendering the result #then one error-colored line carries the kind, code and reason", () => {
    const details: TeamCreateDetails = { kind: "runtime_error", code: "member_start_rejected", reason: MEMBER_START_REASON }
    const rendered = lines(renderTeamCreateResult(toolErrorResult(MEMBER_START_REASON, details), RESULT_OPTIONS, TEST_THEME), 240)

    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toStartWith("[error]team create runtime_error code:member_start_rejected reason:")
    expect(rendered[0]).toContain("bench-landscape")
    expect(rendered[0]).toContain('No available model for category "deep"')
    expect(rendered[0]).toEndWith("[/error]")
  })

  test("#given an invalid_arguments failure #when rendering the result #then the error line has no code token", () => {
    const details: TeamCreateDetails = { kind: "invalid_arguments", reason: "provide team_name or inline_spec" }
    const [line] = lines(renderTeamCreateResult(toolErrorResult("Provide team_name or inline_spec.", details), RESULT_OPTIONS, TEST_THEME))
    expect(line).toBe("[error]team create invalid_arguments reason:provide team_name or inline_spec[/error]")
  })

  test("#given a narrow terminal #when rendering a failed create #then the line is truncated with an ellipsis and never throws", () => {
    const details: TeamCreateDetails = { kind: "runtime_error", code: "member_start_rejected", reason: MEMBER_START_REASON }
    const rendered = lines(renderTeamCreateResult(toolErrorResult(MEMBER_START_REASON, details), RESULT_OPTIONS, TEST_THEME), 40)
    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toContain("...")
  })

  test("#given team_delete args with force #when rendering the call #then it reads team delete run:<id> force", () => {
    const [line] = lines(renderTeamDeleteCall({ team_run_id: "run-1", force: true }, TEST_THEME))
    expect(line).toContain("team delete run:run-1 force")
  })

  test("#given a deleted run and an invalid_state failure #when rendering the results #then success and error colors follow the kind", () => {
    const deleted: TeamDeleteDetails = { kind: "deleted", team_run_id: "run-1", cancelled_task_ids: ["st_a", "st_b"] }
    const invalid: TeamDeleteDetails = { kind: "invalid_state", team_run_id: "run-1", code: "invalid_delete_state", reason: "cannot delete" }

    const [ok] = lines(renderTeamDeleteResult(toolResult("Deleted", deleted), RESULT_OPTIONS, TEST_THEME))
    const [bad] = lines(renderTeamDeleteResult(toolErrorResult("cannot delete", invalid), RESULT_OPTIONS, TEST_THEME))

    expect(ok).toBe("[success]team deleted run:run-1 cancelled:2[/success]")
    expect(bad).toBe("[error]team delete invalid_state code:invalid_delete_state reason:cannot delete[/error]")
  })

  test("#given tasklist calls #when rendering #then each reads team task <op> with its identifying tokens", () => {
    const [create] = lines(renderTeamTaskCall("create", { team_run_id: "run-1", subject: "Write the migration", description: "..." }, TEST_THEME))
    const [get] = lines(renderTeamTaskCall("get", { team_run_id: "run-1", task_id: "7" }, TEST_THEME))
    const [list] = lines(renderTeamTaskCall("list", { team_run_id: "run-1", status: "pending" }, TEST_THEME))
    const [update] = lines(renderTeamTaskCall("update", { team_run_id: "run-1", task_id: "7", status: "completed", owner: "alpha" }, TEST_THEME))

    expect(create).toContain("team task create subject:")
    expect(create).toContain("Write the migration")
    expect(get).toContain("team task get id:7")
    expect(list).toContain("team task list status:pending")
    expect(update).toContain("team task update id:7 status:completed owner:alpha")
  })

  test("#given tasklist results #when rendering #then success kinds carry the task identity and failure kinds render one error line", () => {
    const task = fakeTask({ id: "7", subject: "Write the migration", status: "in_progress", owner: "alpha" })
    const listDetails: TeamTaskListDetails = { kind: "list", tasks: [task, fakeTask({ id: "8", subject: "Review it", status: "pending" })] }
    const getDetails: TeamTaskGetDetails = { kind: "task", task }
    const notFound: TeamTaskGetDetails = { kind: "not_found", task_id: "9" }
    const claimed: TeamTaskUpdateDetails = { kind: "already_claimed", task_id: "7", reason: "task 7 is owned by beta" }

    const list = lines(renderTeamTaskResult("list", toolResult("2 task(s).", listDetails), RESULT_OPTIONS, TEST_THEME))
    const [got] = lines(renderTeamTaskResult("get", toolResult("task", getDetails), RESULT_OPTIONS, TEST_THEME))
    const [missing] = lines(renderTeamTaskResult("get", toolErrorResult("No task '9'.", notFound), RESULT_OPTIONS, TEST_THEME))
    const [conflict] = lines(renderTeamTaskResult("update", toolErrorResult("task 7 is owned by beta", claimed), RESULT_OPTIONS, TEST_THEME))

    expect(list[0]).toBe("[success]team task list count:2[/success]")
    expect(list[1]).toContain("- 7 [in_progress] owner:alpha")
    expect(list[2]).toContain("- 8 [pending]")
    expect(got).toBe("[success]team task 7 [in_progress] owner:alpha subject:Write the migration[/success]")
    expect(missing).toBe("[error]team task get not_found id:9[/error]")
    expect(conflict).toBe("[error]team task update already_claimed id:7 reason:task 7 is owned by beta[/error]")
  })
})
