import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { MassUlwGraph } from "@/components/landing/dag/mass-ulw-graph"

/**
 * The current omo.dev workflow graph (components/landing/dag), with the labels its hero and mass ulw sections passed:
 * `panel` is the graph alone, `app` the whole desktop window with the graph open. It draws from the site tokens, which
 * carry the doriterm palette in both themes.
 */
export async function DagPanel({
  variant,
  testId,
}: {
  readonly variant: "panel" | "app"
  readonly testId: string
}): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <MassUlwGraph
      variant={variant}
      testId={testId}
      regionLabel={t("dag.region")}
      frame={{
        windowTitle: t("dag.windowTitle"),
        threads: t("dag.threads"),
        threadRows: [t("dag.thread1"), t("dag.thread2"), t("dag.thread3")],
        workflow: t("dag.workflow"),
        runStatus: {
          pending: t("dag.status.pending"),
          running: t("dag.status.running"),
          completed: t("dag.status.completed"),
        },
        assistantPlanning: t("dag.assistantPlanning"),
        assistantRunning: t("dag.assistantRunning"),
        assistantDone: t("dag.assistantDone"),
      }}
      graph={{
        wave: t("dag.wave"),
        done: t("dag.done"),
        running: t("dag.running"),
        fit: t("dag.fit"),
        center: t("dag.center"),
      }}
    />
  )
}
