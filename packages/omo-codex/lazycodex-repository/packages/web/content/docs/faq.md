Quick answers to common sticking points. Start with **Install & environment** if you are setting up, **First use** if you are choosing a command, **Execution & verification** if something seems off during a run, and **Conflicts & limits** if you hit a wall.

### Install & environment

**What is LazyCodex?**
OmO packaged for Codex. It layers commands, skills, hooks, model routing, agent roles, diagnostics, and project memory onto Codex so the agent plans before it edits and verifies before it claims done.

**Is LazyCodex a replacement for OmO?**
No. OmO is the core harness. LazyCodex is the Codex distribution: the `npx` installer plus the `omo@sisyphuslabs` marketplace plugin path that makes the OmO harness repeatable inside Codex.

**Can I ask Codex to install it for me?**
Yes. Open Codex and give it the LazyCodex GitHub link or `lazycodex.ai`, then ask it to install. Or run `npx lazycodex-ai install` yourself.

**Is there a difference between Codex App and Codex CLI installs?**
They follow the same flow. LazyCodex installs into the Codex environment. Use whichever surface you prefer — App or CLI.

**Do I need Bun?**
No. Unless you are building LazyCodex from source, Bun is not required. Install and usage go through `npx` with plain Node.js/npm.

**Does it work on Windows?**
Yes. Both the npx installer and the Codex marketplace path support Windows natively. The installer provisions Node.js and Git Bash automatically when they are missing, and shell hooks run through Git Bash. If you already have Node.js and Git for Windows installed, everything works out of the box. See the [Windows section in Installation](./installation.md) for environment variable overrides and bootstrap logs.

### First use

**What kind of tasks is LazyCodex best at?**
Large, long-running work where planning and verification matter. Small questions or one-line fixes can go straight to Codex without the harness.

**Do I need to study every skill before using it?**
No. Skills auto-activate when a task matches their domain. Learn the four commands first; dig into individual skills when you hit a specific need.

**Which commands should I learn first?**
`$init-deep` for project memory, `$ulw-plan` for planning, `$start-work` for executing a plan, and `$ulw-loop` for open-ended tasks that need verified completion.

**How do I know the install worked?**
Open Codex and type `$` in the input — you should see OmO commands and skills listed. On the CLI, typing `ulw` should activate ultrawork mode. The first real command is usually `$init-deep`.

**The $ menu does not show any commands after install.**
Open a new Codex session to reload the plugin, then check whether the startup review has a pending `omo` hook approval. If it still does not show, run `npx lazycodex-ai doctor` to check install and skill loading state.

### Execution & verification

**Is `npx lazycodex-ai doctor` a real thing?**
Yes. It runs the OmO doctor flow and reports what is configured, what is missing, and why. Use it whenever something looks off.

**Why does it ask me to approve hooks?**
Codex reviews hooks at startup. The `omo` hooks do not run until you approve them. After each upgrade the hooks show as **Modified** because the plugin files changed — re-approve to pick up the new version.

**What should I check after an upgrade?**
If hooks show as Modified, re-approve them. If anything looks pending or degraded, run `npx lazycodex-ai doctor` for the full picture.

**`$ulw-loop` keeps finishing too quickly — what do I do?**
Iteration alone does not fix vague completion criteria. Be specific about what you want collected, what verification must pass, and what the agent should investigate when data is missing. Or run `$ulw-plan` first to nail down the scope.

**Do I need a bigger token budget?**
LazyCodex is not a token-saving tool. It pushes good models and enough tokens through planning, execution, and verification. For large tasks, split work into smaller units before a single thread gets too heavy.

**How do I pick a thinking/reasoning level?**
Do not overthink it. Avoid `low`; use `medium` for everyday work; use `high` when failure cost is significant or review matters; save `xhigh` for genuinely heavy tasks.

**Can LazyCodex do computer-use?**
It can, if the Codex session has computer-use tools connected. LazyCodex does not provide those tools itself — it directs the agent to use them during workflows and enforces stronger verification when they are available.

### Conflicts & limits

**Can I use it on desktop and continue on mobile/remote?**
LazyCodex installs into Codex, so it works wherever Codex works. The Codex App's desktop/mobile remote flow pairs well. Some features may only be fully available on the desktop app.

**Team mode shows up but thread creation fails.**
Update LazyCodex and Codex to latest, then run `npx lazycodex-ai doctor`. Team mode depends on Codex desktop app features that may differ between App and CLI.

**Can I use OMX alongside LazyCodex?**
Not recommended. Running both together can cause conflicts that burn tokens and fail silently. If the installer warns about a conflict, remove one. LazyCodex is meant to run as the sole thin layer on top of Codex.
