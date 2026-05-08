import { getTranslations } from "next-intl/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { CodeBlock } from "@/components/ui/code-block"
import { OptionTable } from "@/components/ui/option-table"
import { DocsShell } from "@/components/docs/docs-shell"
import { DOC_SECTION_IDS, DOC_SECTION_TITLE_KEYS } from "@/lib/docs-sections"

export default async function DocsPage() {
  const t = await getTranslations("docs")
  const sections = DOC_SECTION_IDS.map((id) => ({
    id,
    title: t(`sections.${DOC_SECTION_TITLE_KEYS[id]}`),
  }))

  return (
    <DocsShell
      mobileHeader={t("mobileHeader")}
      searchPlaceholder={t("searchPlaceholder")}
      sections={sections}
    >
      <section id="overview" className="scroll-mt-24 space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">{t("overview.title")}</h1>
        <p className="text-muted-foreground text-lg">
          {t("overview.description", { command: "bunx oh-my-openagent install" })}
        </p>
      </section>

      <section id="quick-start" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("quickStart.title")}</h2>
        <CodeBlock
          code={`{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/master/assets/oh-my-openagent.schema.json",
  "agents": {
    "oracle": { "model": "openai/gpt-5.4", "variant": "high" },
    "explore": { "model": "github-copilot/grok-code-fast-1" }
  },
  "categories": {
    "quick": { "model": "opencode/gpt-5-nano" },
    "visual-engineering": { "model": "google/gemini-3.1-pro" }
  }
}`}
        />
      </section>

      <section id="config-locations" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("configLocations.title")}</h2>
        <Card>
          <CardContent className="pt-6">
            <ul className="text-muted-foreground list-disc space-y-2 pl-5">
              <li>
                <code className="text-foreground font-mono">.opencode/oh-my-openagent.json</code>{" "}
                {t("configLocations.projectLevel")}
              </li>
              <li>
                <code className="text-foreground font-mono">
                  ~/.config/opencode/oh-my-openagent.json
                </code>{" "}
                {t("configLocations.userLevel")}
              </li>
            </ul>
            <p className="text-muted-foreground mt-4 text-sm">{t("configLocations.jsonc")}</p>
          </CardContent>
        </Card>
      </section>

      <section id="agents" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t("agentsSection.title")}</h2>
        <p className="text-muted-foreground">{t("agentsSection.description")}</p>

        <h3 className="text-xl font-semibold">{t("agentsSection.overrideOptions")}</h3>
        <OptionTable
          options={[
            { name: "model", type: "string", description: t("agentsSection.options.model") },
            { name: "variant", type: "string", description: t("agentsSection.options.variant") },
            { name: "category", type: "string", description: t("agentsSection.options.category") },
            {
              name: "temperature",
              type: "number",
              description: t("agentsSection.options.temperature"),
            },
            { name: "top_p", type: "number", description: t("agentsSection.options.topP") },
            { name: "prompt", type: "string", description: t("agentsSection.options.prompt") },
            {
              name: "prompt_append",
              type: "string",
              description: t("agentsSection.options.promptAppend"),
            },
            { name: "tools", type: "Record", description: t("agentsSection.options.tools") },
            {
              name: "disable",
              type: "boolean",
              default: "false",
              description: t("agentsSection.options.disable"),
            },
            {
              name: "maxTokens",
              type: "number",
              description: t("agentsSection.options.maxTokens"),
            },
            { name: "thinking", type: "object", description: t("agentsSection.options.thinking") },
            {
              name: "reasoningEffort",
              type: "string",
              description: t("agentsSection.options.reasoningEffort"),
            },
          ]}
        />

        <h3 className="text-xl font-semibold">{t("agentsSection.permissions")}</h3>
        <div className="border-border overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left font-medium">
              <tr>
                <th className="p-3">Permission</th>
                <th className="p-3">Values</th>
                <th className="p-3">Description</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {[
                { name: "edit", descKey: "edit" as const },
                { name: "bash", descKey: "bash" as const },
                { name: "webfetch", descKey: "webfetch" as const },
                { name: "doom_loop", descKey: "doomLoop" as const },
                { name: "external_directory", descKey: "externalDirectory" as const },
              ].map((p) => (
                <tr key={p.name}>
                  <td className="p-3 font-mono font-medium">{p.name}</td>
                  <td className="text-muted-foreground p-3 font-mono">
                    {t("agentsSection.permissionValues")}
                  </td>
                  <td className="text-muted-foreground p-3">
                    {t(`agentsSection.permissionDescriptions.${p.descKey}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="categories" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t("categoriesSection.title")}</h2>
        <p className="text-muted-foreground">{t("categoriesSection.description")}</p>

        <div className="border-border overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left font-medium">
              <tr>
                <th className="p-3">Category</th>
                <th className="p-3">Default Model</th>
                <th className="p-3">Description</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {[
                {
                  name: "visual-engineering",
                  model: "gemini-3.1-pro (high)",
                  descKey: "visualEngineering" as const,
                },
                {
                  name: "ultrabrain",
                  model: "gpt-5.3-codex (xhigh)",
                  descKey: "ultrabrain" as const,
                },
                { name: "deep", model: "gpt-5.3-codex (medium)", descKey: "deep" as const },
                { name: "artistry", model: "gemini-3.1-pro (high)", descKey: "artistry" as const },
                { name: "quick", model: "claude-haiku-4-5", descKey: "quick" as const },
                {
                  name: "unspecified-low",
                  model: "claude-sonnet-4-6",
                  descKey: "unspecifiedLow" as const,
                },
                {
                  name: "unspecified-high",
                  model: "gpt-5.4 (high)",
                  descKey: "unspecifiedHigh" as const,
                },
                { name: "writing", model: "gemini-3-flash", descKey: "writing" as const },
              ].map((c) => (
                <tr key={c.name}>
                  <td className="text-primary p-3 font-mono font-medium">{c.name}</td>
                  <td className="text-muted-foreground p-3 font-mono">{c.model}</td>
                  <td className="text-muted-foreground p-3">
                    {t(`categoriesSection.categories.${c.descKey}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-muted-foreground text-sm">
          {t("categoriesSection.availableOptions", {
            options:
              "model, variant, temperature, top_p, maxTokens, thinking, reasoningEffort, textVerbosity, tools, prompt_append, is_unstable_agent",
          })}
        </p>
      </section>

      <section id="skills" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("skillsSection.title")}</h2>
        <p className="text-muted-foreground">
          {t("skillsSection.description", {
            playwright: "playwright",
            agentBrowser: "agent-browser",
            gitMaster: "git-master",
          })}
        </p>
        <CodeBlock
          code={`"skills": {
  "my-custom-skill": {
    "description": "A custom skill for specific tasks",
    "instructions": "Always use this skill when..."
  }
}`}
        />
      </section>

      <section id="background-tasks" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("backgroundTasksSection.title")}
        </h2>
        <OptionTable
          options={[
            {
              name: "defaultConcurrency",
              type: "number",
              description: t("backgroundTasksSection.options.defaultConcurrency"),
            },
            {
              name: "staleTimeoutMs",
              type: "number",
              description: t("backgroundTasksSection.options.staleTimeoutMs"),
            },
            {
              name: "providerConcurrency",
              type: "number",
              description: t("backgroundTasksSection.options.providerConcurrency"),
            },
            {
              name: "modelConcurrency",
              type: "number",
              description: t("backgroundTasksSection.options.modelConcurrency"),
            },
          ]}
        />
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <span className="font-semibold">{t("backgroundTasksSection.priority")}</span>
          <Badge variant="secondary">modelConcurrency</Badge> &gt;
          <Badge variant="secondary">providerConcurrency</Badge> &gt;
          <Badge variant="secondary">defaultConcurrency</Badge>
        </div>
      </section>

      <section id="hooks" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("hooksSection.title")}</h2>
        <p className="text-muted-foreground mb-4">{t("hooksSection.description")}</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {[
            "agent-usage-reminder",
            "anthropic-context-window-limit-recovery",
            "anthropic-effort",
            "atlas",
            "auto-slash-command",
            "auto-update-checker",
            "background-notification",
            "category-skill-reminder",
            "claude-code-hooks",
            "comment-checker",
            "compaction-context-injector",
            "compaction-todo-preserver",
            "delegate-task-retry",
            "directory-agents-injector",
            "directory-readme-injector",
            "edit-error-recovery",
            "interactive-bash-session",
            "keyword-detector",
            "non-interactive-env",
            "prometheus-md-only",
            "question-label-truncator",
            "ralph-loop",
            "rules-injector",
            "session-recovery",
            "sisyphus-junior-notepad",
            "start-work",
            "stop-continuation-guard",
            "subagent-question-blocker",
            "task-reminder",
            "task-resume-info",
            "tasks-todowrite-disabler",
            "think-mode",
            "thinking-block-validator",
            "unstable-agent-babysitter",
            "write-existing-file-guard",
          ].map((hook) => (
            <div
              key={hook}
              className="border-border bg-card text-muted-foreground rounded border p-2 font-mono text-xs transition-colors"
            >
              {hook}
            </div>
          ))}
        </div>
      </section>

      <section id="mcps" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("mcpsSection.title")}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("mcpsSection.websearch.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                {t("mcpsSection.websearch.description")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("mcpsSection.context7.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                {t("mcpsSection.context7.description")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("mcpsSection.grepApp.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                {t("mcpsSection.grepApp.description")}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="browser-automation" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("browserAutomationSection.title")}
        </h2>
        <div className="border-border overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left font-medium">
              <tr>
                <th className="p-3">Tool</th>
                <th className="p-3">Description</th>
                <th className="p-3">Use Case</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              <tr>
                <td className="text-primary p-3 font-mono font-medium">
                  {t("browserAutomationSection.playwright.tool")}
                </td>
                <td className="text-muted-foreground p-3">
                  {t("browserAutomationSection.playwright.description")}
                </td>
                <td className="text-muted-foreground p-3">
                  {t("browserAutomationSection.playwright.useCase")}
                </td>
              </tr>
              <tr>
                <td className="text-primary p-3 font-mono font-medium">
                  {t("browserAutomationSection.agentBrowser.tool")}
                </td>
                <td className="text-muted-foreground p-3">
                  {t("browserAutomationSection.agentBrowser.description")}
                </td>
                <td className="text-muted-foreground p-3">
                  {t("browserAutomationSection.agentBrowser.useCase")}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="tmux" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("tmuxSection.title")}</h2>
        <OptionTable
          options={[
            { name: "enabled", type: "boolean", description: t("tmuxSection.options.enabled") },
            { name: "layout", type: "string", description: t("tmuxSection.options.layout") },
            {
              name: "main_pane_size",
              type: "string",
              description: t("tmuxSection.options.mainPaneSize"),
            },
          ]}
        />
      </section>

      <section id="git-master" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("gitMasterSection.title")}</h2>
        <OptionTable
          options={[
            {
              name: "commit_footer",
              type: "string",
              description: t("gitMasterSection.options.commitFooter"),
            },
            {
              name: "include_co_authored_by",
              type: "boolean",
              description: t("gitMasterSection.options.includeCoAuthoredBy"),
            },
          ]}
        />
      </section>

      <section id="comment-checker" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("commentCheckerSection.title")}
        </h2>
        <p className="text-muted-foreground">
          {t("commentCheckerSection.description", { placeholder: "{{comments}}" })}
        </p>
        <CodeBlock
          code={`"comment-checker": {
  "custom_prompt": "Review these comments: {{comments}}"
}`}
        />
      </section>

      <section id="experimental" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("experimentalSection.title")}</h2>
        <OptionTable
          options={[
            {
              name: "aggressive_truncation",
              type: "boolean",
              description: t("experimentalSection.options.aggressiveTruncation"),
            },
            {
              name: "auto_resume",
              type: "boolean",
              description: t("experimentalSection.options.autoResume"),
            },
            {
              name: "preemptive_compaction",
              type: "boolean",
              description: t("experimentalSection.options.preemptiveCompaction"),
            },
            {
              name: "truncate_all_tool_outputs",
              type: "boolean",
              description: t("experimentalSection.options.truncateAllToolOutputs"),
            },
          ]}
        />

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="dynamic-pruning">
            <AccordionTrigger>{t("experimentalSection.dynamicPruning.trigger")}</AccordionTrigger>
            <AccordionContent>
              <p className="text-muted-foreground mb-2 text-sm">
                {t("experimentalSection.dynamicPruning.description")}
              </p>
              <CodeBlock
                code={`"dynamic_context_pruning": {
  "enabled": true,
  "strategy": "smart",
  "max_tokens": 10000
}`}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      <section id="lsp" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("lspSection.title")}</h2>
        <OptionTable
          options={[
            { name: "command", type: "string", description: t("lspSection.options.command") },
            { name: "extensions", type: "array", description: t("lspSection.options.extensions") },
            { name: "priority", type: "number", description: t("lspSection.options.priority") },
            { name: "env", type: "object", description: t("lspSection.options.env") },
            {
              name: "initialization",
              type: "object",
              description: t("lspSection.options.initialization"),
            },
            { name: "disabled", type: "boolean", description: t("lspSection.options.disabled") },
          ]}
        />
      </section>

      <section id="env-vars" className="scroll-mt-24 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("envVarsSection.title")}</h2>
        <div className="border-border rounded-lg border p-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-primary font-mono font-bold">
                {t("envVarsSection.opencodeConfigDir.name")}
              </h3>
              <p className="text-muted-foreground mt-1 text-sm">
                {t("envVarsSection.opencodeConfigDir.description")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <Separator className="my-12" />

      <footer className="text-muted-foreground text-sm">
        <p>{t("footer", { year: new Date().getFullYear().toString() })}</p>
      </footer>
    </DocsShell>
  )
}
