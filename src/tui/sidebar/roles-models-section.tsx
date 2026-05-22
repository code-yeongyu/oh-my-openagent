// JSX-RUNTIME-SOURCE: @opentui/solid (verified: node_modules/@opentui/solid/package.json exports ./jsx-runtime)
// Sub-agent / team-member tracking is out of scope: this section only shows roles observed
// in the current leader session. Member panes handle their own routes.
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { useSessionRoleActivity } from "./use-session-role-activity"
import type { RoleRow } from "./derive-row"

type Props = { session_id: string; api: TuiPluginApi }

export function RolesModelsSection(props: Props): JSX.Element {
  const [collapsed, setCollapsed] = createSignal<boolean>(true)
  const [expandedRows, setExpandedRows] = createSignal<Set<string>>(new Set())

  // Architect A4 fix: re-create the subscription when session_id changes.
  // createEffect re-runs whenever props.session_id mutates; Solid automatically runs
  // the previous onCleanup before re-executing the effect, so onCleanup owns teardown.
  let activity: ReturnType<typeof useSessionRoleActivity> | undefined
  createEffect(() => {
    const sid = props.session_id
    activity = useSessionRoleActivity(props.api, sid)
    onCleanup(() => {
      activity?.dispose()
      activity = undefined
    })
  })

  // Theme reactivity (Critic C5 resolution):
  // api.theme.current is a TuiThemeCurrent (tui.d.ts:151-205) — a frozen object of readonly RGBA fields.
  // It is NOT a Solid accessor. There is no `theme.changed` event in the Event union (types.gen.d.ts:819).
  // Theme colors are pinned at component-mount time. Mid-session theme switches do NOT re-render
  // this section until the slot remounts. Documented Non-Goal (FU6).
  const theme = props.api.theme.current

  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.text} on:click={() => setCollapsed(!collapsed())}>
        {collapsed() ? "▸" : "▾"} Roles · Models   {activity?.activeCount() ?? 0}/{activity?.totalCount() ?? 0} active
      </text>
      <Show when={!collapsed() && activity}>
        <For each={activity!.rows()}>
          {(row: RoleRow) => (
            <box flexDirection="column">
              <text
                fg={theme.text}
                on:click={() =>
                  setExpandedRows((prev) => {
                    const next = new Set(prev)
                    if (next.has(row.role)) next.delete(row.role)
                    else next.add(row.role)
                    return next
                  })
                }
              >
                {row.role}   {row.hasEffectiveDefault && row.isOverride ? <text fg={theme.accent}>◆</text> : <text fg={theme.text}>●</text>} {row.providerID}/{row.modelID}
              </text>
              <Show when={expandedRows().has(row.role) && row.hasEffectiveDefault && row.fallbackChain.length > 0}>
                <For each={row.fallbackChain}>
                  {(entry) => (
                    <text fg={theme.textMuted}>
                      {"  "}↓ {entry.model}{entry.variant ? ` (${entry.variant})` : ""}
                    </text>
                  )}
                </For>
              </Show>
            </box>
          )}
        </For>
        {/* Auto-pick footer DEFERRED per Critic C3 / FU5; section ends here in v1. */}
      </Show>
    </box>
  )
}
