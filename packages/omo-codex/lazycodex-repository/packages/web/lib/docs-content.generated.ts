// AUTO-GENERATED — do not edit. Run: node ./scripts/generate-docs-content.mjs
export const DOC_SOURCES: Record<string, string> = {
  "overview.md": "<p>LazyCodex packages <a href=\"https://github.com/code-yeongyu/oh-my-openagent\">OmO</a> as the Codex agent harness for complex codebases: project memory, planning, execution, and verified completion inside Codex. Think <a href=\"https://github.com/LazyVim/LazyVim\">LazyVim</a> for <a href=\"https://github.com/folke/lazy.nvim\">lazy.nvim</a>, but for Codex.</p>\n<blockquote>\n<p><em>&quot;LazyVim made Neovim usable for the rest of us. LazyCodex does the same for Codex.&quot;</em></p>\n</blockquote>\n<h3 id=\"thin-distribution\">Thin distribution</h3>\n<p>LazyCodex itself is close to a small install alias. <code>lazycodex-ai</code> runs the OmO installer targeting the Codex platform, and the actual features come from the <code>omo</code> plugin.</p>\n<h3 id=\"what-gets-installed\">What gets installed</h3>\n<table>\n<thead>\n<tr>\n<th>Layer</th>\n<th>What it means in Codex</th>\n</tr>\n</thead>\n<tbody><tr>\n<td><strong>Commands</strong></td>\n<td><code>$init-deep</code>, <code>$ulw-plan</code>, <code>$start-work</code>, <code>$ulw-loop</code> — workflow entry points.</td>\n</tr>\n<tr>\n<td><strong>Skills</strong></td>\n<td>Review, debugging, refactoring, frontend, LSP, rules injection, and more — specialist playbooks.</td>\n</tr>\n<tr>\n<td><strong>Hooks</strong></td>\n<td>Automatic assistants that fire at session start, prompt submit, post-edit, post-compact, and stop.</td>\n</tr>\n<tr>\n<td><strong>MCP Servers</strong></td>\n<td><code>grep_app</code>, <code>context7</code>, <code>codegraph</code>, <code>git_bash</code>, <code>lsp</code> — tool connections.</td>\n</tr>\n<tr>\n<td><strong>Model routing</strong></td>\n<td>Role-based model profiles so planning, implementation, and verification each get the right model.</td>\n</tr>\n<tr>\n<td><strong>Agent roles</strong></td>\n<td><code>explorer</code>, <code>librarian</code>, <code>plan</code>, <code>momus</code>, <code>metis</code>, and executor/reviewer roles for subagent delegation.</td>\n</tr>\n</tbody></table>\n<h3 id=\"where-it-comes-from\">Where it comes from</h3>\n<p>OmO is the core agent harness: discipline agents, parallel orchestration, multi-model routing, skills, hooks, verified completion, diagnostics, and team mode. LazyCodex packages that harness for Codex through the <code>lazycodex-ai</code> installer and the <code>omo@sisyphuslabs</code> marketplace plugin.</p>\n<h3 id=\"what-you-get\">What you get</h3>\n<p>The OmO harness, wired into Codex with:</p>\n<ul>\n<li>Goal-oriented execution — you give it objectives, not step-by-step recipes.</li>\n<li>A tight operating loop: <strong>Explore → Plan → Implement → Verify → Manually QA</strong>.</li>\n<li>Parallel agent roles so it maps the terrain before writing anything.</li>\n<li>The <code>$ulw-plan</code>, <code>$start-work</code>, and <code>$ulw-loop</code> workflows that keep complex work moving until it is verified.</li>\n<li>Project memory, skills, hooks, MCP tools, model routing, diagnostics, and verification defaults wired into Codex in one pass.</li>\n</ul>\n<h3 id=\"remember-these-four\">Remember these four</h3>\n<ol>\n<li><code>$init-deep</code> creates project memory.</li>\n<li><code>$ulw-plan &quot;what to build&quot;</code> sets the work order.</li>\n<li><code>$start-work</code> executes the plan.</li>\n<li><code>$ulw-loop &quot;task&quot;</code> keeps going until verified.</li>\n</ol>\n<p>LazyCodex wires rules loading, skills, hooks, model routing, and verification habits around this flow. Browse the sidebar docs one section at a time when you need the details.</p>\n<h3 id=\"the-harness-workflow\">The harness workflow</h3>\n<p>Use <code>{your prompt} ultrawork</code> when the job needs the deep worker to run as one coordinated, evidence-bound loop instead of a single turn.</p>\n<h3 id=\"how-it-fits-together\">How it fits together</h3>\n<p>LazyCodex is a thin distribution layer over <a href=\"https://github.com/code-yeongyu/oh-my-openagent\">OmO</a>. The core engine is OmO; LazyCodex packages the OmO harness for Codex.</p>\n<p>Credit: The LazyCodex name idea is inspired by <a href=\"https://github.com/LazyVim/LazyVim\">LazyVim</a>. The Ultragoal and UltraQA ideas are inspired by <a href=\"https://github.com/Yeachan-Heo/oh-my-codex\">oh-my-codex</a>, reimplemented from concept for this Codex setup.</p>\n<ul>\n<li><a href=\"https://github.com/code-yeongyu/lazycodex\">LazyCodex on GitHub</a></li>\n<li><a href=\"https://github.com/code-yeongyu/oh-my-openagent\">OmO on GitHub</a></li>\n<li><a href=\"https://discord.gg/PUwSMR9XNk\">Discord — #building-in-public</a></li>\n<li><a href=\"https://lazycodex.ai\">lazycodex.ai</a></li>\n</ul>\n",
  "installation.md": "<p>One command installs the OmO agent harness for Codex without a global package install.</p>\n<h3 id=\"prerequisites\">Prerequisites</h3>\n<ul>\n<li><a href=\"https://nodejs.org\">Node.js</a> — any maintained LTS; <code>npx</code> ships with it. Bun is <strong>not</strong> required: the installer runs on plain Node.</li>\n<li><a href=\"https://github.com/openai/codex\">OpenAI Codex</a>: the <strong>Codex App</strong> (recommended) or the <strong>Codex CLI</strong>.</li>\n</ul>\n<p>LazyCodex runs <em>inside</em> Codex. Codex must be installed and logged in before you start. If you are setting up for the first time, the Codex App is the easier path — you can open a project and run <code>$command</code> directly from the GUI.</p>\n<blockquote>\n<p>Do NOT use <code>npm install -g</code> or <code>bun add -g</code>. Always invoke via <code>npx</code>.</p>\n</blockquote>\n<h3 id=\"install\">Install</h3>\n<p>The command is one line. No global install, no setup files.</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai install\n</code></pre>\n<p>This is exactly equivalent to <code>npx --yes --package oh-my-openagent omo install --platform=codex</code>.</p>\n<p>To skip the TUI and run a fully autonomous, prompt-free setup:</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai install --no-tui --codex-autonomous\n</code></pre>\n<p>The installer connects commands, skills, hooks, model routing, and verification defaults into your Codex configuration. It is strongly recommended to let an LLM agent run the install — the agent handles subscription detection, model selection, and provider auth automatically.</p>\n<p>After install, the next Codex launch asks you to approve the <code>omo</code> hooks in the startup review. Hooks do not run before approval.</p>\n<p>If the install feels like too many steps, you do not have to run the command yourself. Open Codex and give it the <a href=\"https://lazycodex.ai\">lazycodex.ai</a> link, then ask it to install LazyCodex. The agent reads the docs and walks the setup.</p>\n<blockquote>\n<p><strong>Stuck?</strong> Join the <a href=\"https://discord.gg/6ztZB9jvWq\">LazyCodex Discord</a> and ask <strong>Jobdori</strong> for help.</p>\n</blockquote>\n<h3 id=\"install-from-the-codex-marketplace-experimental\">Install from the Codex marketplace (experimental)</h3>\n<p>The npx installer above stays the primary path. As an additive, experimental alternative you can install from inside Codex itself: type <code>/plugins</code>, open the <strong>Add Marketplace</strong> tab (&quot;Add a marketplace from a Git repo or local root.&quot;), and enter <code>https://github.com/code-yeongyu/lazycodex</code>, then install <code>omo</code> from the <code>sisyphuslabs</code> marketplace. Or from the CLI:</p>\n<pre><code class=\"language-bash\">codex plugin marketplace add https://github.com/code-yeongyu/lazycodex\ncodex plugin add omo@sisyphuslabs\n</code></pre>\n<p>On the next launch, approve the omo hooks in Codex&#39;s startup review — hooks never run before approval. The first approved session prints <code>LazyCodex bootstrap running in background — restart the session when it completes</code> while a background worker finishes the setup (config blocks, agent roles, bin links, a pinned <code>sg</code> binary for the <code>ast_grep</code> MCP); restart when it is done. The marketplace path never touches Codex permission settings — autonomous mode remains the explicit <code>npx lazycodex-ai install --no-tui --codex-autonomous</code> choice.</p>\n<p>Upgrade with <code>codex plugin marketplace upgrade sisyphuslabs</code>. The next startup review shows the hooks as <strong>Modified</strong> — expected after every upgrade, because the plugin files changed and the previous trust hashes no longer match — re-approve them and the following session re-runs bootstrap on the new version. If anything looks pending or degraded, <code>npx lazycodex-ai doctor</code> explains what and why.</p>\n<h3 id=\"authentication\">Authentication</h3>\n<p>Auth targets <strong>Codex itself</strong>, not LazyCodex. The Codex CLI logs in during its own setup; the Codex App logs in through the app UI. There is no separate LazyCodex login command.</p>\n<p>Once Codex is logged in, <code>npx lazycodex-ai install</code> handles subscription detection, model selection, and provider routing. If you let an LLM agent run the install, it walks the same process for you.</p>\n<p>To check what is configured:</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai doctor\n</code></pre>\n<p><code>doctor</code> explains what is set up, what is missing, and why it matters. See <a href=\"#configuration\">Configuration</a> for provider and routing details.</p>\n<h3 id=\"windows\">Windows</h3>\n<p>Native Windows works with both install paths.</p>\n<ul>\n<li><strong>Node:</strong> <code>npx lazycodex-ai install</code> needs Node.js on <code>PATH</code> (LTS recommended). On marketplace installs the bootstrap step provisions a pinned Node LTS runtime into <code>%USERPROFILE%\\.codex\\runtime\\node\\</code> automatically when <code>node</code> is missing — installing Node yourself first also works and skips the download.</li>\n<li><strong>Git Bash:</strong> required for shell hooks. The installer and the marketplace bootstrap both try <code>winget install --id Git.Git -e --source winget</code> when Git Bash is missing. If Git lives somewhere custom, set <code>OMO_CODEX_GIT_BASH_PATH</code> to a path like <code>C:\\Program Files\\Git\\bin\\bash.exe</code>.</li>\n<li><strong><code>where bash</code> shows <code>C:\\Windows\\System32\\bash.exe</code>:</strong> that is the WSL launcher, not Git Bash — LazyCodex intentionally ignores <code>System32</code> and <code>WindowsApps</code> <code>bash.exe</code> shims when resolving Git Bash. Install Git for Windows or point <code>OMO_CODEX_GIT_BASH_PATH</code> at a real Git Bash so the resolver finds it.</li>\n<li><strong>Troubleshooting:</strong> the Windows marketplace bootstrap writes a transcript to <code>%USERPROFILE%\\.codex\\plugins\\data\\omo-sisyphuslabs\\bootstrap\\ps-bootstrap.log</code>; degraded lines look like <code>degraded component=node reason=... hint=npx lazycodex-ai doctor</code>. Run <code>npx lazycodex-ai doctor</code> for the full health report.</li>\n</ul>\n<h3 id=\"let-an-agent-do-it\">Let an agent do it</h3>\n<p>It is strongly recommended to let an LLM agent run the install and walk the setup for you. The agent handles subscription detection, model selection, and provider auth automatically.</p>\n",
  "recommended-environment.md": "<p>The smoothest environment for LazyCodex is Ubuntu or macOS. The harness leans on shell, Git, Node.js/npm, Codex config files, and hooks — all of which behave predictably on Unix-like systems.</p>\n<h3 id=\"operating-system\">Operating system</h3>\n<table>\n<thead>\n<tr>\n<th>OS</th>\n<th>Recommendation</th>\n<th>Notes</th>\n</tr>\n</thead>\n<tbody><tr>\n<td><strong>Ubuntu</strong></td>\n<td>Most recommended</td>\n<td>Server and dev environments both have predictable paths, shells, and package management.</td>\n</tr>\n<tr>\n<td><strong>macOS</strong></td>\n<td>Recommended</td>\n<td>Good for local development. Homebrew plus Node.js/npm is all you need.</td>\n</tr>\n<tr>\n<td><strong>Windows</strong></td>\n<td>Not recommended</td>\n<td>Native Windows shells and path differences cause unnecessary friction with hooks, CLI, file permissions, and script execution.</td>\n</tr>\n</tbody></table>\n<p>If you must use Windows, run Codex and LazyCodex inside <strong>WSL2 Ubuntu</strong> rather than native Windows. Keep the project on the WSL2 filesystem for the most stable experience.</p>\n<h3 id=\"before-you-install\">Before you install</h3>\n<table>\n<thead>\n<tr>\n<th>Item</th>\n<th>Expected state</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>Codex</td>\n<td>Codex App or Codex CLI installed and logged in.</td>\n</tr>\n<tr>\n<td>Node.js/npm</td>\n<td>A maintained Node.js LTS. <code>npx</code> ships with npm.</td>\n</tr>\n<tr>\n<td>Project</td>\n<td>A repository opened in Codex that you want to work in.</td>\n</tr>\n<tr>\n<td>Git</td>\n<td>A Git repository so changes can be tracked and reverted.</td>\n</tr>\n<tr>\n<td>Secrets</td>\n<td>Provider keys live in the shell or Codex environment — never pasted into project files.</td>\n</tr>\n</tbody></table>\n<p>You do <strong>not</strong> need to install Bun unless you are building LazyCodex from source. Normal install and usage go through the <code>npx</code> path.</p>\n<p>Check your versions first:</p>\n<pre><code class=\"language-bash\">node -v\nnpm -v\nnpx -v\n</code></pre>\n<p>If they are missing, install Node.js:</p>\n<pre><code class=\"language-bash\"># Ubuntu or WSL2 Ubuntu\nsudo apt update\nsudo apt install -y nodejs npm\n\n# macOS\nbrew install node\n</code></pre>\n<h3 id=\"author-recommendations\">Author recommendations</h3>\n<ul>\n<li><strong>Start with the Codex App.</strong> Install, login, session management, and skill invocation are all visible in the GUI, which is less confusing for first-time users.</li>\n<li><strong>Use ChatGPT Pro or above.</strong> The docs assume the Codex usage environment that comes with ChatGPT Pro and above.</li>\n<li><strong>Try bare Codex first.</strong> If you have never used a coding agent before, spend a session with Codex alone before adding LazyCodex on top. Understanding how the base agent responds and edits files makes the harness layer easier to follow.</li>\n<li><strong>Stick to supported models.</strong> Mixing in GLM, Kimi, Mimo, or other non-default model stacks is not recommended. The docs and skill flows are written around Codex and OmO defaults.</li>\n</ul>\n",
  "getting-started.md": "<p>LazyCodex is most useful as a harness for complex codebases: project memory, planning, execution, verified completion, skills, hooks, model routing, and diagnostics. This page walks through install verification and the four commands you will reach for most often.</p>\n<h3 id=\"prerequisites\">Prerequisites</h3>\n<ul>\n<li><code>npx</code> available from a Node.js/npm install. Bun is not required.</li>\n<li>Codex App or <a href=\"https://github.com/openai/codex\">OpenAI Codex CLI</a>.</li>\n</ul>\n<p>LazyCodex connects OmO commands, skills, and hooks into Codex configuration. If Codex is working normally, the install flow is the same for App and CLI.</p>\n<h3 id=\"install\">Install</h3>\n<p>The simplest approach: open a new task in Codex, give it the LazyCodex GitHub link, and ask it to install.</p>\n<pre><code class=\"language-text\">https://github.com/code-yeongyu/lazycodex\n\nInstall LazyCodex from this repository.\n</code></pre>\n<p>If you prefer running the command directly:</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai install\n</code></pre>\n<p>After install, reopen Codex and check that OmO commands and skills appear in the <code>$</code> menu. The next launch asks you to approve the <code>omo</code> hooks in the startup review — hooks do not run before approval.</p>\n<p>If the status shows <code>pending</code> or <code>degraded</code>, run the diagnostic first:</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai doctor\n</code></pre>\n<h3 id=\"authentication\">Authentication</h3>\n<p>LazyCodex has no separate login. The installer (or the agent running it) handles subscription detection, model selection, and provider auth. Codex App or Codex CLI must already be logged in, but that is a prerequisite rather than a LazyCodex-specific step.</p>\n<p>See <a href=\"#configuration\">Configuration</a> for provider and routing details.</p>\n<h3 id=\"the-four-commands\">The four commands</h3>\n<table>\n<thead>\n<tr>\n<th>Command</th>\n<th>Use it when</th>\n</tr>\n</thead>\n<tbody><tr>\n<td><code>$init-deep</code></td>\n<td>The repository is too large or too old to explain from memory.</td>\n</tr>\n<tr>\n<td><code>$ulw-plan</code></td>\n<td>The work needs decisions before any code is written.</td>\n</tr>\n<tr>\n<td><code>$start-work</code></td>\n<td>A plan exists and should be executed to completion.</td>\n</tr>\n<tr>\n<td><code>$ulw-loop</code></td>\n<td>You want the agent to keep going until the result is verified.</td>\n</tr>\n</tbody></table>\n<h3 id=\"your-first-run\">Your first run</h3>\n<p>Start by giving the agent project context with hierarchical <code>AGENTS.md</code> memory:</p>\n<pre><code class=\"language-text\">$init-deep\n</code></pre>\n<p>Then pick the command that matches your task.</p>\n<p><strong>If you need to plan first</strong> — this reads the repository and writes a decision-complete plan without touching product code. Approve the plan before it executes.</p>\n<pre><code class=\"language-text\">$ulw-plan &quot;add a done-toggle helper to the small task app&quot;\n</code></pre>\n<p><strong>If a plan already exists</strong> — execute it. All checkboxes must complete before it stops.</p>\n<pre><code class=\"language-text\">$start-work\n</code></pre>\n<p><strong>If you want end-to-end verified completion</strong> — the loop keeps going until evidence proves the result.</p>\n<pre><code class=\"language-text\">$ulw-loop &quot;fix the payment flow failure and verify end to end&quot;\n</code></pre>\n<h3 id=\"how-to-choose\">How to choose</h3>\n<p>Start with <code>$init-deep</code> once per repository so agents have hierarchical <code>AGENTS.md</code> context to work from.</p>\n<p>For anything ambiguous, run <code>$ulw-plan</code> first. It interviews you, explores the codebase in parallel, and writes a decision-complete plan to <code>plans/&lt;slug&gt;.md</code> without touching product code.</p>\n<p>Hand that plan to <code>$start-work</code> to execute it: durable Boulder state, parallel subagents, strict TDD, and five evidence gates. It prints <code>ORCHESTRATION COMPLETE</code> when every checkbox is done.</p>\n<p><code>$ulw-loop</code> is the tightest loop — use it for a single task that must run until an oracle verifies completion. It does not plan; it executes and verifies.</p>\n<h3 id=\"a-typical-session\">A typical session</h3>\n<pre><code class=\"language-text\">$init-deep\n$ulw-plan &quot;add rate limiting to the api gateway&quot;\n$start-work plans/add-rate-limiting.md\n</code></pre>\n<p>If the job is small and well-understood, skip the plan and loop directly:</p>\n<pre><code class=\"language-text\">ulw fix the flaky checkout test\n</code></pre>\n<p>See <a href=\"#skills\">Feature coverage</a> for the skills that add specialist judgment around these commands.</p>\n",
  "faq.md": "<p>Quick answers to common sticking points. Start with <strong>Install &amp; environment</strong> if you are setting up, <strong>First use</strong> if you are choosing a command, <strong>Execution &amp; verification</strong> if something seems off during a run, and <strong>Conflicts &amp; limits</strong> if you hit a wall.</p>\n<h3 id=\"install-amp-environment\">Install &amp; environment</h3>\n<p><strong>What is LazyCodex?</strong>\nOmO packaged for Codex. It layers commands, skills, hooks, model routing, agent roles, diagnostics, and project memory onto Codex so the agent plans before it edits and verifies before it claims done.</p>\n<p><strong>Is LazyCodex a replacement for OmO?</strong>\nNo. OmO is the core harness. LazyCodex is the Codex distribution: the <code>npx</code> installer plus the <code>omo@sisyphuslabs</code> marketplace plugin path that makes the OmO harness repeatable inside Codex.</p>\n<p><strong>Can I ask Codex to install it for me?</strong>\nYes. Open Codex and give it the LazyCodex GitHub link or <code>lazycodex.ai</code>, then ask it to install. Or run <code>npx lazycodex-ai install</code> yourself.</p>\n<p><strong>Is there a difference between Codex App and Codex CLI installs?</strong>\nThey follow the same flow. LazyCodex installs into the Codex environment. Use whichever surface you prefer — App or CLI.</p>\n<p><strong>Do I need Bun?</strong>\nNo. Unless you are building LazyCodex from source, Bun is not required. Install and usage go through <code>npx</code> with plain Node.js/npm.</p>\n<p><strong>Does it work on Windows?</strong>\nYes. Both the npx installer and the Codex marketplace path support Windows natively. The installer provisions Node.js and Git Bash automatically when they are missing, and shell hooks run through Git Bash. If you already have Node.js and Git for Windows installed, everything works out of the box. See the <a href=\"#installation\">Windows section in Installation</a> for environment variable overrides and bootstrap logs.</p>\n<h3 id=\"first-use\">First use</h3>\n<p><strong>What kind of tasks is LazyCodex best at?</strong>\nLarge, long-running work where planning and verification matter. Small questions or one-line fixes can go straight to Codex without the harness.</p>\n<p><strong>Do I need to study every skill before using it?</strong>\nNo. Skills auto-activate when a task matches their domain. Learn the four commands first; dig into individual skills when you hit a specific need.</p>\n<p><strong>Which commands should I learn first?</strong>\n<code>$init-deep</code> for project memory, <code>$ulw-plan</code> for planning, <code>$start-work</code> for executing a plan, and <code>$ulw-loop</code> for open-ended tasks that need verified completion.</p>\n<p><strong>How do I know the install worked?</strong>\nOpen Codex and type <code>$</code> in the input — you should see OmO commands and skills listed. On the CLI, typing <code>ulw</code> should activate ultrawork mode. The first real command is usually <code>$init-deep</code>.</p>\n<p><strong>The $ menu does not show any commands after install.</strong>\nOpen a new Codex session to reload the plugin, then check whether the startup review has a pending <code>omo</code> hook approval. If it still does not show, run <code>npx lazycodex-ai doctor</code> to check install and skill loading state.</p>\n<h3 id=\"execution-amp-verification\">Execution &amp; verification</h3>\n<p><strong>Is <code>npx lazycodex-ai doctor</code> a real thing?</strong>\nYes. It runs the OmO doctor flow and reports what is configured, what is missing, and why. Use it whenever something looks off.</p>\n<p><strong>Why does it ask me to approve hooks?</strong>\nCodex reviews hooks at startup. The <code>omo</code> hooks do not run until you approve them. After each upgrade the hooks show as <strong>Modified</strong> because the plugin files changed — re-approve to pick up the new version.</p>\n<p><strong>What should I check after an upgrade?</strong>\nIf hooks show as Modified, re-approve them. If anything looks pending or degraded, run <code>npx lazycodex-ai doctor</code> for the full picture.</p>\n<p><strong><code>$ulw-loop</code> keeps finishing too quickly — what do I do?</strong>\nIteration alone does not fix vague completion criteria. Be specific about what you want collected, what verification must pass, and what the agent should investigate when data is missing. Or run <code>$ulw-plan</code> first to nail down the scope.</p>\n<p><strong>Do I need a bigger token budget?</strong>\nLazyCodex is not a token-saving tool. It pushes good models and enough tokens through planning, execution, and verification. For large tasks, split work into smaller units before a single thread gets too heavy.</p>\n<p><strong>How do I pick a thinking/reasoning level?</strong>\nDo not overthink it. Avoid <code>low</code>; use <code>medium</code> for everyday work; use <code>high</code> when failure cost is significant or review matters; save <code>xhigh</code> for genuinely heavy tasks.</p>\n<p><strong>Can LazyCodex do computer-use?</strong>\nIt can, if the Codex session has computer-use tools connected. LazyCodex does not provide those tools itself — it directs the agent to use them during workflows and enforces stronger verification when they are available.</p>\n<h3 id=\"conflicts-amp-limits\">Conflicts &amp; limits</h3>\n<p><strong>Can I use it on desktop and continue on mobile/remote?</strong>\nLazyCodex installs into Codex, so it works wherever Codex works. The Codex App&#39;s desktop/mobile remote flow pairs well. Some features may only be fully available on the desktop app.</p>\n<p><strong>Team mode shows up but thread creation fails.</strong>\nUpdate LazyCodex and Codex to latest, then run <code>npx lazycodex-ai doctor</code>. Team mode depends on Codex desktop app features that may differ between App and CLI.</p>\n<p><strong>Can I use OMX alongside LazyCodex?</strong>\nNot recommended. Running both together can cause conflicts that burn tokens and fail silently. If the installer warns about a conflict, remove one. LazyCodex is meant to run as the sole thin layer on top of Codex.</p>\n",
  "init-deep.md": "<p><code>$init-deep</code> generates hierarchical <code>AGENTS.md</code> context so agents start from local guidance before touching a large repository. Run it once per project, and again whenever the architecture shifts enough that the existing context no longer reflects reality.</p>\n<h3 id=\"what-it-produces\">What it produces</h3>\n<ul>\n<li>A root <code>AGENTS.md</code> that orients agents to the project: stack, layout, conventions, and where to look first.</li>\n<li>Nested <code>AGENTS.md</code> files in the directories that matter most, so an agent descending into a package gets scoped guidance instead of guessing.</li>\n<li>References to project rules, skills, and instruction files the harness should respect.</li>\n</ul>\n<h3 id=\"when-to-run-it\">When to run it</h3>\n<ul>\n<li>Onboarding a repository that is too large or too old to explain from memory.</li>\n<li>After a major refactor, migration, or layout change.</li>\n<li>When agents keep picking the wrong files or ignoring local conventions.</li>\n</ul>\n<h3 id=\"how-to-use-it\">How to use it</h3>\n<pre><code class=\"language-text\">$init-deep\n</code></pre>\n<p>The command walks the tree, reads the files that define how the project actually works, and writes the context. Review the generated <code>AGENTS.md</code> files, trim anything stale, and commit them. Agents in later turns read that context before they edit, so the first session pays for every session after it.</p>\n<h3 id=\"after-init\">After init</h3>\n<p>With context in place, move to <a href=\"#ulw-plan\"><code>$ulw-plan</code></a> when the work needs a plan, or <a href=\"#ulw-loop\"><code>$ulw-loop</code></a> for a single verified task.</p>\n",
  "ulw-plan.md": "<p><code>$ulw-plan</code> is the strategic planning consultant (Prometheus). It turns an idea into a decision-complete work plan. It is a planner, NOT an implementer. When you say &quot;do X&quot; it produces a plan for X and never writes product code.</p>\n<h3 id=\"the-flow\">The flow</h3>\n<ol>\n<li><strong>Socratic interview</strong> — ask only the forks that exploration cannot resolve. When intent is fuzzy, research to best practice instead of interrogating.</li>\n<li><strong>Parallel codebase exploration</strong> — fan out read-only subagents to ground every decision in the actual code, never in memory.</li>\n<li><strong>Metis gap analysis</strong> — name every unknown the plan depends on and either close it or surface it as an explicit fork.</li>\n<li><strong>Write the plan</strong> to <code>plans/&lt;slug&gt;.md</code> — one decision-complete plan a worker executes with zero further interview.</li>\n<li><strong>Optional Momus high-accuracy review</strong> — an adversarial pass that tries to break the plan before it ships.</li>\n</ol>\n<h3 id=\"output\">Output</h3>\n<p>Questions, research, and a work plan whose every todo carries references, acceptance criteria, a QA plan, and a commit boundary. The plan records <code>status: awaiting-approval</code> and waits — it never begins execution itself.</p>\n<h3 id=\"handoff\">Handoff</h3>\n<p>Once you approve, hand the plan to <a href=\"#start-work\"><code>$start-work</code></a>, which executes it against durable Boulder state with the five evidence gates.</p>\n",
  "start-work.md": "<p><code>$start-work</code> executes a Prometheus work plan until every top-level checkbox is done.</p>\n<h3 id=\"how-it-works\">How it works</h3>\n<ul>\n<li>Durable Boulder state in <code>.omo/boulder.json</code> survives across turns and sessions</li>\n<li>A Stop-hook re-injects the next turn until the plan is complete</li>\n<li>Independent sub-tasks fan out to parallel subagents</li>\n<li>Strict TDD plus five evidence gates: plan reread, automated verification, manual-QA, adversarial QA, cleanup</li>\n<li>Progress is recorded to a ledger</li>\n</ul>\n<h3 id=\"syntax\">Syntax</h3>\n<pre><code class=\"language-bash\">$start-work [plan-name] [--worktree &lt;absolute-path&gt;]\n</code></pre>\n<h3 id=\"done\">Done</h3>\n<p>It prints an <code>ORCHESTRATION COMPLETE</code> block when every checkbox is checked.</p>\n",
  "ulw-loop.md": "<p><code>$ulw-loop</code> is a self-referential development loop that decomposes work into systematic, evidence-bound steps and runs until verified completion.</p>\n<h3 id=\"how-it-works\">How it works</h3>\n<p>The agent works continuously and emits <code>&lt;promise&gt;DONE&lt;/promise&gt;</code> when it believes the task is complete, but that does NOT end the loop. An Oracle must verify the result first. The loop ends only after the system confirms the Oracle verified it. If verification fails, it continues with the message: &quot;Oracle verification failed. Continuing ULTRAWORK loop.&quot;</p>\n<p>Each step carries its own evidence: a real artifact, not a dry-run claim. Progress is checkpointed, so a long run survives restarts without losing what was already proven.</p>\n<h3 id=\"bootstrap\">Bootstrap</h3>\n<p>Before the first run, the loop reads its full workflow reference (Bootstrap tier triage, the Execution Loop, and the Manual-QA channels table) so every later phase executes the same way. It only reads the sections the current phase needs.</p>\n<h3 id=\"manual-qa-channels\">Manual-QA channels</h3>\n<p>A step does not close on a status string. It closes on a captured artifact from a real surface — an HTTP call, a tmux session, or a browser — plus an adversarial pass and a cleanup receipt. See <a href=\"#manual-qa\">manual QA</a>.</p>\n<h3 id=\"syntax\">Syntax</h3>\n<pre><code class=\"language-bash\">$ulw-loop &quot;task description&quot; [--completion-promise=TEXT] [--strategy=reset|continue]\n</code></pre>\n<h3 id=\"limits\">Limits</h3>\n<p>The iteration cap is 500 in ultrawork mode (100 in normal mode).</p>\n<h3 id=\"reading-more\">Reading more</h3>\n<ul>\n<li><a href=\"#ultrawork\">ultrawork mode</a> — the mode that turns the loop into a binding verified run.</li>\n<li><a href=\"#hooks-lifecycle\">Hooks &amp; Lifecycle</a> — how the Stop-hook re-injects the next turn.</li>\n</ul>\n",
  "skills.md": "<p>Skills are specialist playbooks that LazyCodex loads on top of the command pillars. They auto-activate when a task matches their domain — you do not need to study or memorize them. Include <code>ultrawork</code> (or the short alias <code>ulw</code>) in your prompt and the harness picks the right skills internally.</p>\n<p>When you want to call a skill explicitly, put its name in the prompt: <code>$review-work</code>, <code>$remove-ai-slops</code>, <code>$ulw-research</code>, and so on.</p>\n<h3 id=\"commands\">Commands</h3>\n<p>The command pillars stay simple:</p>\n<ul>\n<li><code>$init-deep</code> — project memory</li>\n<li><code>$ulw-plan</code> — decision-complete planning before coding</li>\n<li><code>$start-work</code> — execute a plan with durable Boulder progress</li>\n<li><code>$ulw-loop</code> — evidence-bound loop until verified completion</li>\n</ul>\n<p>Skills add specialist judgment around those pillars. The sections below describe each skill and how it is typically used.</p>\n<h3 id=\"skill-index\">Skill index</h3>\n<p>Most skills auto-activate when a request matches their domain, so you do not need to study or manually select every skill before using LazyCodex. When you want to be explicit, put the skill name in the prompt — for example <code>$visual-qa</code>, <code>$git-master</code>, or <code>$ulw-research</code>.</p>\n<table>\n<thead>\n<tr>\n<th>Skill</th>\n<th>Use it for</th>\n</tr>\n</thead>\n<tbody><tr>\n<td><code>init-deep</code></td>\n<td>Hierarchical <code>AGENTS.md</code> context for large or old repos</td>\n</tr>\n<tr>\n<td><code>ulw-plan</code></td>\n<td>Explore-first planning before coding</td>\n</tr>\n<tr>\n<td><code>ulw-loop</code></td>\n<td>Evidence-bound loop until verified completion</td>\n</tr>\n<tr>\n<td><code>start-work</code></td>\n<td>Execute a plan with durable Boulder progress</td>\n</tr>\n<tr>\n<td><code>review-work</code></td>\n<td>Five-lane parallel post-implementation review</td>\n</tr>\n<tr>\n<td><code>remove-ai-slops</code></td>\n<td>Behavior-preserving cleanup of AI-looking code</td>\n</tr>\n<tr>\n<td><code>frontend</code></td>\n<td>Designed UI work instead of generic layout filling</td>\n</tr>\n<tr>\n<td><code>programming</code></td>\n<td>Strict TypeScript, Rust, Python, or Go discipline, TDD-first</td>\n</tr>\n<tr>\n<td><code>git-master</code></td>\n<td>Atomic commits, rebase/squash, push safety, history investigation</td>\n</tr>\n<tr>\n<td><code>visual-qa</code></td>\n<td>Screenshot/TUI diff plus dual-oracle visual QA</td>\n</tr>\n<tr>\n<td><code>debugging</code></td>\n<td>Evidence-led root-cause investigation</td>\n</tr>\n<tr>\n<td><code>refactor</code></td>\n<td>Behavior-preserving restructure of existing code</td>\n</tr>\n<tr>\n<td><code>ulw-research</code></td>\n<td>Maximum-saturation research with codebase, web, official-docs, and OSS-repo swarms</td>\n</tr>\n<tr>\n<td><code>LSP</code></td>\n<td>Diagnostics, definitions, references, symbols, and renames</td>\n</tr>\n<tr>\n<td><code>lsp-setup</code></td>\n<td>Configure language servers for a project</td>\n</tr>\n<tr>\n<td><code>AST-grep</code></td>\n<td>Structural search and rewrite across code</td>\n</tr>\n<tr>\n<td><code>rules</code></td>\n<td>Project instructions from AGENTS, rules, and instruction files</td>\n</tr>\n<tr>\n<td><code>comment-checker</code></td>\n<td>Feedback after edit-like operations</td>\n</tr>\n</tbody></table>\n<h3 id=\"skill-highlights\">Skill highlights</h3>\n<hr>\n<h3 id=\"review-work\">review-work</h3>\n<p>Five-lane parallel post-implementation review.</p>\n<p>After significant work, <code>review-work</code> launches five sub-agents in parallel — each covering a different angle: goal/constraint verification, hands-on QA execution, code quality, security, and context mining from git history and issues. All five must pass for the review to pass. One failure means the review fails.</p>\n<p><strong>When it activates:</strong> After completing any meaningful implementation — especially when the change touches 3+ files or runs for 20+ minutes.</p>\n<p><strong>Example:</strong> After finishing a PR, the user says:</p>\n<pre><code class=\"language-text\">review my work\n</code></pre>\n<p>The harness spawns five parallel reviewers in separate threads, each with a focused lens. The final verdict is PASS only when every lane agrees.</p>\n<hr>\n<h3 id=\"remove-ai-slops\">remove-ai-slops</h3>\n<p>Behavior-preserving cleanup of AI-generated code smells.</p>\n<p>The safety invariant: regression tests lock behavior <em>before</em> a single line is deleted. Covers obvious comments, excessive defensive code, unnecessary abstractions, dead code, duplicates, and oversized modules (250+ pure LOC triggers a full modular refactoring). Workers run in parallel batches of five, and any test failure triggers an immediate revert.</p>\n<p><strong>When it activates:</strong> When asked to clean, deslop, or remove AI-generated patterns.</p>\n<p><strong>Example:</strong> Combining with <code>refactor</code> and <code>programming</code> for a full cleanup pass:</p>\n<pre><code class=\"language-text\">ulw plan and manual qa, no behaviour changes, no regressions\n/refactor /remove-ai-slops through /programming\n</code></pre>\n<p>The harness plans the cleanup first, locks behavior with tests, then dispatches parallel workers by slop category — safe to dangerous order.</p>\n<hr>\n<h3 id=\"frontend\">frontend</h3>\n<p>UI, UX, design, performance, accessibility, and visual QA — all in one router.</p>\n<p>Not a single rule file but a router. It reads design, perfection, and ui-ux-db references based on the task, then builds and verifies against the actual browser. Covers UI implementation, styling, layout, animation, Lighthouse 100, Core Web Vitals, accessibility, SEO, and React dev tools like <code>react-scan</code> and <code>react-doctor</code>.</p>\n<p><strong>When it activates:</strong> Any task involving UI, styling, layout, animation, design, or performance auditing.</p>\n<p><strong>Example:</strong></p>\n<pre><code class=\"language-text\">redesign the sidebar with better spacing and hit Lighthouse 100\n</code></pre>\n<p>The skill routes to the right design references, builds to match the existing design system, then runs a real Playwright Chromium Lighthouse audit — never the Lighthouse CLI, never by weakening UX.</p>\n<hr>\n<h3 id=\"programming\">programming</h3>\n<p>One philosophy across four languages: strict types, modern stacks, TDD.</p>\n<p>Applies to every <code>.py</code>, <code>.pyi</code>, <code>.rs</code>, <code>.ts</code>, <code>.tsx</code>, <code>.mts</code>, <code>.cts</code>, <code>.go</code> file. The skill gates on language, loads the matching reference set, and enforces: parse-don&#39;t-validate at boundaries, exhaustive variant matching, typed errors, no escape hatches (<code>any</code>, <code>unwrap</code>, <code>@ts-ignore</code>), 250 pure LOC ceiling per file, and mandatory TDD (RED → GREEN → REFACTOR).</p>\n<p><strong>When it activates:</strong> Automatically on any code file edit in the supported languages.</p>\n<p><strong>Example:</strong> The skill is always on. When editing TypeScript, it loads the TypeScript reference (Bun + Biome + strict tsconfig), enforces branded types and discriminated unions, and runs the post-write review loop: measure pure LOC, self-review seven questions, refactor if over 250 LOC.</p>\n<hr>\n<h3 id=\"debugging\">debugging</h3>\n<p>Hypothesis-driven runtime debugging across any language or binary.</p>\n<p>Every claim about why a bug happens must come from observed runtime state, not code reading. The skill runs a phased loop: setup and journal, form 3+ orthogonal hypotheses, investigate in parallel, escalate to independent verifiers after 2 failed rounds, confirm root cause by toggling, lock with a failing test, fix minimally, QA on the real surface, then clean up every debug artifact.</p>\n<p><strong>When it activates:</strong> Crashes, silent failures, wrong responses, stuck processes, memory leaks, async misbehavior, or reverse engineering.</p>\n<p><strong>Example:</strong></p>\n<pre><code class=\"language-text\">debug this — the API returns 200 but the body is empty\n</code></pre>\n<p>The skill fires parallel investigation lanes, attaches real debuggers (pdb, node inspect, lldb, dlv), and does not close the bug until the root cause is confirmed by toggling and a failing test goes GREEN.</p>\n<hr>\n<h3 id=\"refactor\">refactor</h3>\n<p>Codemap-aware, LSP- and AST-grep-powered restructuring.</p>\n<p>Maps the codebase before touching anything, evaluates test coverage to set the verification strategy, plans atomic steps with rollback points, then executes with LSP renames and AST-grep structural rewrites. Any test failure during execution triggers an immediate stop and revert.</p>\n<p><strong>When it activates:</strong> Requests to refactor, restructure, extract, simplify, or modernize code.</p>\n<p><strong>Example:</strong></p>\n<pre><code class=\"language-text\">refactor the validation logic into its own module --scope=module\n</code></pre>\n<p>The skill builds a dependency graph of the target, runs characterization tests to pin current behavior, then executes the restructuring step by step — verifying after each step.</p>\n<hr>\n<h3 id=\"visual-qa\">visual-qa</h3>\n<p>Screenshot and TUI diff plus dual-oracle visual QA.</p>\n<p>Captures reference and actual evidence — screenshots for web UIs, <code>tmux capture-pane</code> for terminal UIs — then runs a bundled pixel-diff or column-width script. Two parallel read-only oracle passes evaluate: one for design-system and functional integrity, one for visual fidelity and CJK text precision. The final verdict is a single good/bad score.</p>\n<p><strong>When it activates:</strong> After building or changing any UI, or when asked to verify visual correctness.</p>\n<hr>\n<h3 id=\"git-master\">git-master</h3>\n<p>Atomic commits, rebase/squash, push safety, history investigation.</p>\n<p>Handles commit message style detection, semantic grouping, fixup autosquash, blame, bisect, <code>log -S</code>, and questions like &quot;who wrote this&quot; or &quot;when was this added.&quot;</p>\n<p><strong>When it activates:</strong> Any git operation — committing, rebasing, squashing, history search.</p>\n<hr>\n<h3 id=\"ulw-research\">ulw-research</h3>\n<p>Maximum-saturation research mode (formerly <code>ultraresearch</code>).</p>\n<p>Orchestrates parallel explore and librarian swarms across the codebase, the web, official documentation, and OSS repositories. Runs a recursive EXPAND loop driven by leads that workers return, verifies findings empirically by running code, and produces cited synthesis with optional reports.</p>\n<p><strong>When it activates:</strong> Only on explicit demand — the word <code>ulw-research</code>, the legacy alias <code>ultraresearch</code>, or any request for deep research or an ultra-precise investigation.</p>\n<p><strong>Example:</strong></p>\n<pre><code class=\"language-text\">ulw-research the typeclaw architecture — map every module and find the official docs\n</code></pre>\n<p>The skill fans out 10+ parallel search lanes across GitHub, official docs, and web sources, recursively expands promising leads, then synthesizes a cited report.</p>\n<hr>\n<h3 id=\"lsp\">LSP</h3>\n<p>Language-server diagnostics, definitions, references, symbols, and safe renames.</p>\n<p>Gives the agent language-server precision via MCP tool calls. Runs diagnostics after every edit, finds definitions and references across the workspace, and performs safe renames through the language server&#39;s own workspace edit — not text find-and-replace.</p>\n<p><strong>When it activates:</strong> Automatically after edit-like tool calls (diagnostics), and on demand for navigation and renames.</p>\n<hr>\n<h3 id=\"ast-grep\">AST-grep</h3>\n<p>Structural search and rewrite across 25 languages.</p>\n<p>Finds code by syntactic shape rather than text — every function call matching a pattern, every import shaped like X. Rewrites are deterministic and always previewed with <code>dryRun=true</code> before applying. Pairs with the <code>refactor</code> skill for safe, large-scale codemods.</p>\n<p><strong>When it activates:</strong> Structural code matching, pattern-based search, or deterministic rewrites (strip <code>as any</code>, migrate <code>require()</code> to <code>import</code>, find empty catch blocks).</p>\n<hr>\n<h3 id=\"lsp-setup\">lsp-setup</h3>\n<p>Language-server installation and workspace wiring.</p>\n<p>Configures language servers when a project does not already expose reliable diagnostics, definitions, references, and safe renames. It detects the language stack, installs or points to the right server, and validates that LSP calls work before higher-level coding or refactor skills depend on them.</p>\n<p><strong>When it activates:</strong> When diagnostics are missing, definitions cannot be resolved, or a project needs LSP support before a refactor or programming task.</p>\n<hr>\n<h3 id=\"rules\">rules</h3>\n<p>Project instruction injection from repository and user rule files.</p>\n<p>Automatically loads project instructions from sources such as <code>AGENTS.md</code>, <code>CONTEXT.md</code>, <code>.omo/rules/</code>, <code>.claude/rules/</code>, <code>.github/instructions/</code>, and <code>.github/copilot-instructions.md</code>. There is no command to run — the harness treats these rules as active context when the plugin is enabled.</p>\n<p><strong>When it activates:</strong> At session start and prompt submission, so agents inherit project constraints before planning or editing.</p>\n<hr>\n<h3 id=\"comment-checker\">comment-checker</h3>\n<p>Immediate feedback after edit-like operations.</p>\n<p>After code changes, <code>comment-checker</code> inspects comments near the edited lines. If it flags comment drift — a comment that no longer matches the code below it — the agent must fix or justify the comment before proceeding. This catches stale comments at the moment they are introduced rather than during a later review.</p>\n<p><strong>When it activates:</strong> After write, edit, patch, or other edit-like tool calls when the plugin has the guardrail enabled.</p>\n<hr>\n<h3 id=\"where-skills-live\">Where skills live</h3>\n<p>LazyCodex installs skills as part of the OmO plugin. OmO can also load skills from project and user locations such as <code>.codex/skills</code>, <code>~/.codex/skills</code>, <code>.opencode/skills</code>, <code>~/.config/opencode/skills</code>, <code>.claude/skills</code>, <code>.agents/skills</code>, and <code>~/.agents/skills</code>.</p>\n<p>LazyCodex installs the Codex Light setup with:</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai install\n</code></pre>\n<p>That installer wires the Codex marketplace plugin as <code>omo@sisyphuslabs</code> while keeping the public package alias easy to remember.</p>\n<p>Each skill carries deep internal references — detailed playbooks, language-specific recipes, and per-phase instructions — but none of that is something you need to read. The harness reads it for you when the skill activates.</p>\n<p>The command pillars and the disciplines behind them are covered in depth: <a href=\"#ulw-plan\">ulw-plan</a>, <a href=\"#ulw-loop\">ulw-loop</a>, <a href=\"#start-work\">start-work</a>, <a href=\"#tdd\">TDD</a>, <a href=\"#manual-qa\">manual QA</a>, and <a href=\"#git-workflow\">git workflow</a>.</p>\n",
  "ultrawork.md": "<p>ultrawork is the headline mode. Include <code>ultrawork</code> (or the short alias <code>ulw</code>) anywhere in your prompt — like adding <code>ultrathink</code> — and the harness switches to maximum-precision, outcome-first, evidence-driven orchestration. Skills activate internally; you do not need to name them.</p>\n<blockquote>\n<p>&quot;Plan, execute, verify, and keep the evidence attached.&quot;</p>\n</blockquote>\n<p>The principle is simple. An agent saying it is done does not mean the work is done. The work is done when <strong>observable evidence verifies</strong> it.</p>\n<h3 id=\"usage\">Usage</h3>\n<p>Just include the word in your prompt. Nothing else to configure.</p>\n<pre><code class=\"language-text\">ulw add authentication\n</code></pre>\n<pre><code class=\"language-text\">fix the flaky checkout test ultrawork\n</code></pre>\n<p>The harness reads the task, picks the right skills (programming, debugging, refactor, etc.), and runs the evidence-bound loop automatically. You do not choose skills yourself unless you want to be explicit — for example <code>$review-work</code> or <code>$ulw-research</code>.</p>\n<h3 id=\"what-it-enforces\">What it enforces</h3>\n<ul>\n<li>Strict TDD: RED → GREEN → SURFACE → CLEAN</li>\n<li>At least 3 realistic QA scenarios scaled to the risk of the task</li>\n<li>Real manual-QA channels (HTTP call, tmux, browser, computer use, CLI stdout, data diff)</li>\n<li>A binding verification gate that loops until the work is genuinely done</li>\n</ul>\n<h3 id=\"relationship-to-ulw-loop\">Relationship to <code>$ulw-loop</code></h3>\n<p><code>$ulw-loop</code> is the command form of ultrawork discipline. The latest flow stores request, goals, success criteria, and an evidence ledger under <code>.omo/ulw-loop</code>:</p>\n<table>\n<thead>\n<tr>\n<th>File</th>\n<th>Role</th>\n</tr>\n</thead>\n<tbody><tr>\n<td><code>.omo/ulw-loop/brief.md</code></td>\n<td>Original request and persistent constraints</td>\n</tr>\n<tr>\n<td><code>.omo/ulw-loop/goals.json</code></td>\n<td>Goals and success criteria</td>\n</tr>\n<tr>\n<td><code>.omo/ulw-loop/ledger.jsonl</code></td>\n<td>pass, fail, block, steering, checkpoint records</td>\n</tr>\n</tbody></table>\n<p>Saying &quot;done&quot; is not enough. Each success criterion requires evidence captured from a real surface, and that evidence must pass before the loop stops.</p>\n<p>The exact syntax and flags live in the <a href=\"#ulw-loop\"><code>$ulw-loop</code> command docs</a>.</p>\n<h3 id=\"failure-limits\">Failure limits</h3>\n<p>The loop does not run forever. The latest <code>$ulw-loop</code> workflow uses these caps:</p>\n<table>\n<thead>\n<tr>\n<th>Condition</th>\n<th>Limit</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>Iterations on one goal without a full pass</td>\n<td>5 cycles</td>\n</tr>\n<tr>\n<td>Same failure on the same criterion</td>\n<td>3 times</td>\n</tr>\n</tbody></table>\n<h3 id=\"evidence-over-hope\">Evidence over hope</h3>\n<p>The loop does not stop at &quot;I wrote some code.&quot; It stops when the result is confirmed by evidence — what check ran and what it showed — not by the agent&#39;s expected status report.</p>\n<h3 id=\"position-among-commands\">Position among commands</h3>\n<p><code>$ulw-loop</code> is one of several commands, each for a different shape of work.</p>\n<p>The typical flow: <code>$ulw-plan</code> produces a decision-complete plan, <code>$start-work</code> executes it checkpoint by checkpoint, and <code>$ulw-loop</code> keeps open-ended work running until a verifier approves. Detailed syntax for each command is in the <a href=\"#ulw-plan\">Commands</a> section.</p>\n",
  "discipline-agents.md": "<p>LazyCodex installs OmO&#39;s discipline-agent surface into Codex. <strong>Hephaestus</strong> remains the autonomous deep-worker voice for end-to-end implementation, while specialist roles support exploration, external research, planning, review, QA, and completion gates.</p>\n<h3 id=\"what-hephaestus-is\">What Hephaestus is</h3>\n<p>Named after the Greek god of the forge. Goal-oriented: you give it objectives, not step-by-step recipes, and it executes them end-to-end. &quot;The Legitimate Craftsman.&quot; Methodical, thorough, obsessive — built for deep architectural reasoning, complex debugging, and cross-domain synthesis.</p>\n<h3 id=\"installed-roles\">Installed roles</h3>\n<p>The current install provides these roles. When Codex exposes <code>agent_type</code>, the role is set directly; otherwise the role description is included in the message as a fallback.</p>\n<table>\n<thead>\n<tr>\n<th>Role</th>\n<th>Primary use</th>\n</tr>\n</thead>\n<tbody><tr>\n<td><code>explorer</code></td>\n<td>Internal codebase context: structure, call flows, test locations.</td>\n</tr>\n<tr>\n<td><code>librarian</code></td>\n<td>External docs, library contracts, latest API research.</td>\n</tr>\n<tr>\n<td><code>plan</code></td>\n<td>Plan drafting and task decomposition.</td>\n</tr>\n<tr>\n<td><code>momus</code> / <code>metis</code></td>\n<td>Missing decisions, edge cases, risk review.</td>\n</tr>\n<tr>\n<td><code>lazycodex-executor</code></td>\n<td>Executing specific task units from a plan.</td>\n</tr>\n<tr>\n<td><code>lazycodex-code-reviewer</code></td>\n<td>Post-implementation code quality review.</td>\n</tr>\n<tr>\n<td><code>lazycodex-qa-executor</code></td>\n<td>Real-execution-based QA.</td>\n</tr>\n<tr>\n<td><code>lazycodex-gate-reviewer</code></td>\n<td>Pre-completion verification gates.</td>\n</tr>\n<tr>\n<td><code>lazycodex-clone-fidelity-reviewer</code></td>\n<td>Clone and sync operation fidelity checks.</td>\n</tr>\n</tbody></table>\n<h3 id=\"parent-session-ownership\">Parent session ownership</h3>\n<p>Even with multiple roles, completion judgment is never handed wholesale to a sub-agent. The parent Codex session keeps ownership of goals, constraints, and final judgment. Sub-agents are used to read terrain, find gaps, or assist review.</p>\n<h3 id=\"the-operating-loop\">The operating loop</h3>\n<p>Hephaestus runs a short, tight loop on every unit of work:</p>\n<ol>\n<li><strong>Explore</strong> — map the terrain. Read the code with tools, never speculate. Fire 2-5 parallel explore subagents before writing anything.</li>\n<li><strong>Plan</strong> — chart the course. Record files to modify, specific changes, and dependencies via <code>update_plan</code>.</li>\n<li><strong>Implement</strong> — build with precision. Surgical edits that match codebase style (naming, indentation, imports, error handling) even when a greenfield would read differently.</li>\n<li><strong>Verify</strong> — prove it works. LSP diagnostics on changed files, related tests, and build — in parallel where possible.</li>\n<li><strong>Manually QA</strong> — drive the artifact through its real surface (HTTP call, tmux, browser), then write the final message.</li>\n</ol>\n<h3 id=\"non-goals\">Non-goals</h3>\n<ul>\n<li><strong>Never trusts subagent self-reports.</strong> Verification is independent; a child saying &quot;done&quot; does not close the work.</li>\n<li><strong>Never proposes when you asked for code.</strong> Unless you explicitly want a plan or a brainstorm, it implements.</li>\n<li><strong>Never speculates about code it has not read.</strong> Exploration is cheap; assumption is expensive.</li>\n<li><strong>Never leaves work unresolved at end of turn.</strong> Every plan step is reconciled: <code>completed</code>, blocked (one-line reason), or removed (one-line reason).</li>\n</ul>\n<h3 id=\"delegation-and-orchestration\">Delegation and orchestration</h3>\n<p>The parent Codex session keeps final ownership of goals and verification. For parallel work it can spawn Codex subagent roles and keep the parent session live with brief status updates while children run. Team mode adds a durable named-team surface when coordination is worth the overhead.</p>\n<h3 id=\"boulder-state\">Boulder state</h3>\n<p><code>$start-work</code> uses <code>.omo/boulder.json</code> to persist progress and the Stop-hook continuation to keep plan execution moving. This is the core visible behavior: checkboxes advance, and when all are done it prints <strong>ORCHESTRATION COMPLETE</strong>.</p>\n<h3 id=\"where-the-boulder-comes-from\">Where the boulder comes from</h3>\n<p>OmO&#39;s broader orchestration ideas show up in Codex through durable <code>.omo/boulder.json</code> progress, Stop-hook continuation, named team state, and reviewer/gate roles. <a href=\"#start-work\"><code>$start-work</code></a> is the main visible path: it advances the plan until every checkbox is done and the final gate is satisfied.</p>\n<h3 id=\"reading-more\">Reading more</h3>\n<ul>\n<li><a href=\"#ultrawork\">ultrawork mode</a> — the mode that turns the loop into a binding verified run.</li>\n<li><a href=\"#hooks-lifecycle\">Hooks &amp; Lifecycle</a> — how the Stop-hook re-injects the next turn until the plan is complete.</li>\n</ul>\n",
  "model-routing.md": "<p>Multi-model routing sends each part of a run to the model that fits it best, instead of running everything on one model. LazyCodex installs OmO&#39;s routing defaults into Codex so a serious repository is not bottlenecked by a single context window or price point.</p>\n<h3 id=\"current-baseline\">Current baseline</h3>\n<p>The <code>4.12.1</code> bundled <code>model-catalog.json</code> centers the default profile on <code>gpt-5.5</code>:</p>\n<table>\n<thead>\n<tr>\n<th>Profile</th>\n<th>Model</th>\n<th>Reasoning</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>Default</td>\n<td><code>gpt-5.5</code></td>\n<td><code>high</code></td>\n</tr>\n<tr>\n<td>Plan mode</td>\n<td><code>gpt-5.5</code></td>\n<td><code>xhigh</code></td>\n</tr>\n<tr>\n<td>Worker</td>\n<td><code>gpt-5.5</code></td>\n<td><code>high</code></td>\n</tr>\n<tr>\n<td>Verifier</td>\n<td><code>gpt-5.5</code></td>\n<td><code>high</code></td>\n</tr>\n</tbody></table>\n<p>The actual model name you see may differ as Codex and OpenAI update their model lineup. This doc focuses on <em>how</em> LazyCodex uses model profiles, not on comparing specific models.</p>\n<h3 id=\"what-gets-routed\">What gets routed</h3>\n<ul>\n<li><strong>Planning and exploration</strong> go to a strong reasoning model that can hold a large context and weigh trade-offs.</li>\n<li><strong>Implementation turns</strong> go to a fast, capable coding model for the bulk of the edit loop.</li>\n<li><strong>Verification</strong> goes to a model used as an oracle, chosen for judgment rather than throughput.</li>\n<li><strong>Specialist skills</strong> can target their own model when a skill benefits from a specific profile.</li>\n</ul>\n<h3 id=\"why-role-profiles-exist\">Why role profiles exist</h3>\n<p>Role-based profiles separate work by nature:</p>\n<ul>\n<li>General tasks follow the default model setting.</li>\n<li>Plan mode may demand stronger reasoning.</li>\n<li>Worker and verifier are kept separate so the same result is checked from a different angle.</li>\n</ul>\n<p>This pairs with <a href=\"#discipline-agents\">Agent Roles</a>. Even when multiple roles move in parallel, each role&#39;s model profile is tracked in the Codex configuration.</p>\n<h3 id=\"how-it-fits-the-harness\">How it fits the harness</h3>\n<p>Routing is part of the harness setup that <code>npx lazycodex-ai install</code> wires into Codex. It detects the available subscriptions and provider auth, then maps roles to models so you do not hand-configure each one.</p>\n<h3 id=\"provider-auth\">Provider auth</h3>\n<p>Auth targets Codex itself, not LazyCodex. Once Codex is logged in, the installer&#39;s subscription detection and provider routing take over. If you let an LLM agent run the install, it walks the same detection and selection for you.</p>\n<h3 id=\"user-notes\">User notes</h3>\n<ul>\n<li>The model name you see after install may differ from what the docs list. The installed <code>model-catalog.json</code> and the models your Codex build supports take precedence.</li>\n<li>Model settings balance quality and speed. Lowering them arbitrarily can degrade planning, review, and QA quality together.</li>\n<li>When in doubt, check install state and Codex config first.</li>\n</ul>\n<h3 id=\"customizing-it\">Customizing it</h3>\n<p>Routing and provider settings live in the configuration. See <a href=\"#configuration\">Configuration</a> for the fields that control which model handles which role, and how to override the defaults per project.</p>\n",
  "hooks-lifecycle.md": "<p>Hooks and lifecycle are how the harness keeps a long run moving without you re-prompting every turn. OmO installs lifecycle hooks into Codex that observe each turn and decide what happens next.</p>\n<h3 id=\"trigger-matrix\">Trigger matrix</h3>\n<table>\n<thead>\n<tr>\n<th>Event</th>\n<th>What fires</th>\n</tr>\n</thead>\n<tbody><tr>\n<td><code>SessionStart</code></td>\n<td>Project rules loading, telemetry, auto-update check, bootstrap provisioning, CodeGraph bootstrap.</td>\n</tr>\n<tr>\n<td><code>UserPromptSubmit</code></td>\n<td>Project rules re-injection, ultrawork trigger detection, <code>$ulw-loop</code> steering.</td>\n</tr>\n<tr>\n<td><code>PreToolUse</code></td>\n<td>Git Bash MCP guidance on Bash calls, <code>$ulw-loop</code> goal budget protection on goal creation.</td>\n</tr>\n<tr>\n<td><code>PostToolUse</code></td>\n<td>Comment checker, LSP diagnostics, CodeGraph init guidance, <code>apply_patch</code> rule matching, thread title hygiene.</td>\n</tr>\n<tr>\n<td><code>Stop</code> / <code>SubagentStop</code></td>\n<td><code>$start-work</code> continuation, LazyCodex executor evidence verification.</td>\n</tr>\n<tr>\n<td><code>PostCompact</code></td>\n<td>Git Bash notification, project rules, and LSP diagnostics cache resets.</td>\n</tr>\n</tbody></table>\n<h3 id=\"the-core-mechanism\">The core mechanism</h3>\n<p>A Stop-hook fires when a turn ends. If a plan is still in progress, the hook re-injects the next turn automatically — the agent continues from durable progress state instead of waiting for you to say &quot;continue&quot;. The run only stops when the plan is complete or a gate fails in a way that needs a human.</p>\n<h3 id=\"where-progress-lives\">Where progress lives</h3>\n<p>Progress state is written to <code>.omo/boulder.json</code> and survives across turns and sessions. That is what lets <a href=\"#start-work\"><code>$start-work</code></a> resume a plan after a restart, and what keeps <a href=\"#ulw-loop\"><code>$ulw-loop</code></a> honest about how far it has actually gotten.</p>\n<h3 id=\"approval-and-trust\">Approval and trust</h3>\n<p>Hooks never run before approval. On the first launch after install, Codex&#39;s startup review asks you to approve the omo hooks. After every upgrade the hooks show as <strong>Modified</strong> — expected, because the plugin files changed and the previous trust hashes no longer match — re-approve and the next session re-runs bootstrap on the new version.</p>\n<h3 id=\"evidence-gates\">Evidence gates</h3>\n<p>During execution the lifecycle enforces five evidence gates before a step can close: plan reread, automated verification, manual-QA, adversarial QA, and cleanup. A step that cannot pass its gates does not advance, regardless of what the status text claims.</p>\n<h3 id=\"installed-components\">Installed components</h3>\n<p>The hooks above are thin entry points into these installed components:</p>\n<table>\n<thead>\n<tr>\n<th>Component</th>\n<th>Responsibility</th>\n</tr>\n</thead>\n<tbody><tr>\n<td><code>rules</code></td>\n<td>Project rules at session start, prompt submit, <code>apply_patch</code>, and post-compact.</td>\n</tr>\n<tr>\n<td><code>bootstrap</code></td>\n<td>LazyCodex install state and provisioning checks.</td>\n</tr>\n<tr>\n<td><code>telemetry</code></td>\n<td>Session start recording.</td>\n</tr>\n<tr>\n<td><code>comment-checker</code></td>\n<td>Comment feedback after edit-like tool calls.</td>\n</tr>\n<tr>\n<td><code>lsp</code></td>\n<td>Language-server diagnostics after edit-like tool calls and cache reset after compact.</td>\n</tr>\n<tr>\n<td><code>ultrawork</code></td>\n<td>Ultrawork trigger detection at prompt submit.</td>\n</tr>\n<tr>\n<td><code>ulw-loop</code></td>\n<td>Loop steering and goal budget protection.</td>\n</tr>\n<tr>\n<td><code>start-work-continuation</code></td>\n<td><code>$start-work</code> execution continuation.</td>\n</tr>\n<tr>\n<td><code>git-bash</code></td>\n<td>Git Bash MCP guidance on Bash calls and post-compact.</td>\n</tr>\n<tr>\n<td><code>codegraph</code></td>\n<td>CodeGraph bootstrap and init guidance.</td>\n</tr>\n<tr>\n<td><code>teammode</code></td>\n<td>Thread title hygiene checks.</td>\n</tr>\n<tr>\n<td><code>lazycodex-executor-verify</code></td>\n<td>Sub-agent evidence verification.</td>\n</tr>\n</tbody></table>\n<h3 id=\"reading-more\">Reading more</h3>\n<ul>\n<li><a href=\"#ultrawork\">ultrawork mode</a> — the mode that turns these gates into a binding loop.</li>\n<li><a href=\"#configuration\">Configuration</a> — how to tune hook behavior and lifecycle defaults.</li>\n</ul>\n",
  "git-workflow.md": "<p>Git work runs through the <code>git-master</code> skill. It is exact, conservative, and evidence-led: the agent reads the repository state before it infers anything, and never commits, rebases, pushes, force-pushes, resets, or stash-pops unless you explicitly asked for that operation.</p>\n<h3 id=\"mode-gate\">Mode gate</h3>\n<p>Every request is classified first:</p>\n<ul>\n<li><code>COMMIT</code> — stage and commit local changes.</li>\n<li><code>REBASE</code> — rebase, squash, fixup, autosquash, reorder, or split branch history.</li>\n<li><code>HISTORY</code> — answer when, where, who, why, or which commit changed something.</li>\n<li><code>STATUS</code> — inspect branch, diff, or working-tree state without changing it.</li>\n</ul>\n<p>Investigative requests report findings and stop.</p>\n<h3 id=\"commit-mode\">Commit mode</h3>\n<p>Commits are atomic by behavior, module, and revertability. The agent detects message style from recent history (dominant pattern, language, casing — it does not default to Conventional Commits unless the repo uses them), inspects the full diff, and stages by path or hunk so each commit contains only its group. Implementation and its direct tests land together; unrelated concerns split into separate commits. Before each commit it verifies <code>git diff --staged --stat</code>; after, <code>git log -1 --oneline</code>.</p>\n<h3 id=\"rebase-and-merge\">Rebase and merge</h3>\n<p>History rewriting is a shared-impact operation. The agent never rebases or rewrites <code>main</code>, <code>master</code>, <code>dev</code>, release, or protected branches unless you named that exact operation. If commits may already be pushed, it asks before force-pushing and uses <code>--force-with-lease</code>, never plain <code>--force</code>. Conflicts are resolved by intent — never a blind ours/theirs. If a rebase goes wrong, <code>git rebase --abort</code> is the first move; the reflog is the recovery path, explained before use.</p>\n<h3 id=\"push-safety\">Push safety</h3>\n<p>Before any write to history: the current branch is known, dirty work is accounted for, upstream/pushed status is known or explicitly unknown, the operation matches your request, and the recovery path is known. Afterward it runs the cheapest relevant verification and leaves the worktree state explicit.</p>\n<h3 id=\"reading-more\">Reading more</h3>\n<ul>\n<li><a href=\"#start-work\">start-work</a> — the executor that lands planned work as commits.</li>\n<li><a href=\"#manual-qa\">manual QA</a> — the gates a step passes before it is allowed to close.</li>\n</ul>\n",
  "tdd.md": "<p>Strict test-driven development is the discipline that lets the harness call work &quot;done&quot; without hoping. Every change follows the red → green → refactor loop, in that order. Reverse it and you have written speculative code.</p>\n<h3 id=\"the-order\">The order</h3>\n<ol>\n<li><strong>Red.</strong> Write a failing test that names the behavior in <code>Given / When / Then</code>. Run it. Confirm it fails for the right reason — not a typo or a missing import.</li>\n<li><strong>Green.</strong> Write the minimum code to make it pass. Resist the second case until the first passes; the second case is the next red.</li>\n<li><strong>Refactor.</strong> With the test green, restructure ruthlessly. If the test is hard to refactor against, the test is bad — fix it before the code.</li>\n</ol>\n<h3 id=\"the-test-pyramid\">The test pyramid</h3>\n<p>Every feature ships all three rungs: many fast units (pure-function correctness across happy, edge, boundary, and error paths, &lt; 10 ms each), some integrations against the real downstream via testcontainers or httptest (&lt; 1 s each), and a few E2E scenarios that drive the binary through its real surface and assert the observable outcome. A feature with zero E2E coverage is undone, even if every unit passes.</p>\n<h3 id=\"deterministic-or-it-is-broken\">Deterministic, or it is broken</h3>\n<p>A test that passes 9 of 10 times is failing 10% of the time. Forbidden in test bodies unless time itself is the system under test: <code>setTimeout(resolve, N)</code>, <code>await sleep(N)</code>, &quot;wait long enough for X&quot;. The replacement is subscribe-first, timeout-bound — register the listener before the trigger, then race against an explicit circuit breaker that fails with a useful message on timeout. The whole repo must pass <code>bun test</code> in one process, one go, no isolation flags, no retries.</p>\n<h3 id=\"prompt-tests-assert-behavior-not-text\">Prompt tests assert behavior, not text</h3>\n<p>When testing code that builds an LLM prompt, never pin the current wording (<code>toContain(&quot;You are Sisyphus&quot;)</code>, <code>toMatchSnapshot</code>, <code>toBe(EXPECTED_PROMPT)</code>). Assert the structural invariant the logic enforces — the conditional branch, the negative branch, the redaction, the skill inclusion/exclusion. Test what would break the behavior, never what would only break a diff.</p>\n<h3 id=\"the-five-evidence-gates\">The five evidence gates</h3>\n<p>During execution the lifecycle enforces five gates before a step can close: plan reread, automated verification, <a href=\"#manual-qa\">manual QA</a>, adversarial QA, and cleanup. A step that cannot pass its gates does not advance, regardless of what the status text claims.</p>\n<h3 id=\"reading-more\">Reading more</h3>\n<ul>\n<li><a href=\"#ultrawork\">ultrawork mode</a> — the mode that makes the loop binding.</li>\n<li><a href=\"#start-work\">start-work</a> — where the five gates are enforced per checkbox.</li>\n</ul>\n",
  "manual-qa.md": "<p>Manual QA is the gate that turns &quot;it should work&quot; into &quot;it works, here is the proof&quot;. No step closes on a status string; it closes on a captured artifact from a real surface, plus an adversarial pass and a cleanup receipt. Two skills carry this: <code>visual-qa</code> for UI surfaces, <code>review-work</code> for whole-implementation review.</p>\n<h3 id=\"visual-qa\">visual-qa</h3>\n<p>For any UI you built or changed — web page or TUI — visual QA runs three phases. First it captures objective reference evidence with a bundled diff script: <code>image-diff</code> for screenshots (similarity score, hotspots, <code>alphaChannelIntact</code>), <code>tui-check</code> for terminal captures (<code>maxWidth</code>, <code>overflowLines</code>, <code>borderMisaligned</code>, wide-char columns). That JSON is reference, not the verdict.</p>\n<p>Then it dispatches two read-only oracle subagents in parallel:</p>\n<ul>\n<li><strong>Pass A — design-system and functional integrity.</strong> The deeper, stricter pass. Proves the surface is a real design-system implementation driven by coherent tokens and reused primitives, not a mock-only screen or a pasted raster faked as live elements. Checks alpha, responsiveness, and that the user-intended features actually work.</li>\n<li><strong>Pass B — visual fidelity and CJK precision.</strong> The focused pass. Opens the screenshots directly and inspects source/content for clipping, baseline drop, glyph breakage, and Korean/Japanese/Chinese precision.</li>\n</ul>\n<p>The harness synthesizes the two passes into one <code>PASS | REVISE | FAIL</code> verdict with located findings.</p>\n<h3 id=\"review-work\">review-work</h3>\n<p>After significant implementation, <code>review-work</code> launches five parallel background subagents. All five must pass for the review to pass; if one fails, the review fails.</p>\n<table>\n<thead>\n<tr>\n<th>Lane</th>\n<th>Role</th>\n<th>Asks</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>1</td>\n<td>Goal Verifier</td>\n<td>Did we build what was asked?</td>\n</tr>\n<tr>\n<td>2</td>\n<td>QA Executor</td>\n<td>Does it actually work?</td>\n</tr>\n<tr>\n<td>3</td>\n<td>Code Reviewer</td>\n<td>Is the code well-written?</td>\n</tr>\n<tr>\n<td>4</td>\n<td>Security Auditor</td>\n<td>Is it secure?</td>\n</tr>\n<tr>\n<td>5</td>\n<td>Context Miner</td>\n<td>Did we miss any context?</td>\n</tr>\n</tbody></table>\n<p>Oracle lanes receive the diff plus full file contents in the prompt (they cannot read files). A crashed, <code>BLOCKED:</code>, or inconclusive lane is never counted as a pass — it is respawned smaller, and if the retry budget is exhausted it stays <code>INCONCLUSIVE</code> while the aggregate result still emits.</p>\n<h3 id=\"adversarial-classes-and-cleanup\">Adversarial classes and cleanup</h3>\n<p>Within <a href=\"#start-work\"><code>$start-work</code></a>, every checkbox probes each applicable adversarial class and records the observable result for each; skipped classes need a one-line not-applicable reason in the ledger. Every QA resource — scripts, tmux assets, browser sessions, PIDs, ports, containers, temp dirs — is registered as its own teardown todo and executed with a captured receipt. No QA asset is left running.</p>\n<h3 id=\"reading-more\">Reading more</h3>\n<ul>\n<li><a href=\"#tdd\">TDD</a> — the automated-verification gate that precedes manual QA.</li>\n<li><a href=\"#ulw-loop\">ulw-loop</a> — the loop whose completion depends on this gate.</li>\n</ul>\n",
  "configuration.md": "<p>LazyCodex is a thin distribution layer over <a href=\"https://github.com/code-yeongyu/oh-my-openagent\">OmO</a>. The configuration that the installer writes into Codex controls model routing, hooks, skills, and the agent roles the harness uses.</p>\n<h3 id=\"zero-config-by-default\">Zero-config by default</h3>\n<p>LazyCodex ships with sensible defaults and works immediately after install. You only need to touch configuration when the defaults do not fit your repository. There are no config files to create in advance — install and start working.</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai install\n</code></pre>\n<p>No global install. Always <code>npx</code>. This is shorthand for <code>npx --yes --package oh-my-openagent omo install --platform=codex</code>.</p>\n<h3 id=\"codex-target\">Codex target</h3>\n<p>LazyCodex always targets Codex. The <code>--platform=codex</code> argument is baked into the <code>lazycodex-ai</code> bin&#39;s <code>install</code> path, so the harness connects to the <a href=\"https://github.com/openai/codex\">OpenAI Codex CLI</a> and not another platform. You do not pass <code>--platform</code> yourself.</p>\n<p><strong>Prerequisites:</strong></p>\n<ul>\n<li><a href=\"https://nodejs.org\">Node.js</a> — any maintained LTS; <code>npx</code> ships with it. Bun is not required.</li>\n<li><a href=\"https://github.com/openai/codex\">OpenAI Codex CLI</a> or the Codex App, logged in.</li>\n</ul>\n<h3 id=\"where-config-lives\">Where config lives</h3>\n<ul>\n<li>Codex configuration that the installer connects to.</li>\n<li>Project-level <code>AGENTS.md</code> and rule files that shape agent behavior per repository.</li>\n<li>User-level skill locations such as <code>~/.config/opencode/skills</code> and <code>~/.agents/skills</code>.</li>\n</ul>\n<h3 id=\"install-flags\">Install flags</h3>\n<p>The default installer is interactive (TUI). It detects subscriptions, helps with model selection, and walks provider auth.</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai install\n</code></pre>\n<p>For a fully autonomous, prompt-free setup, add both flags together:</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai install --no-tui --codex-autonomous\n</code></pre>\n<p><code>--no-tui --codex-autonomous</code> are passed through to <code>omo install</code> — the <code>lazycodex-ai</code> bin does not interpret them itself. It is strongly recommended to let an LLM agent run the install: the agent handles subscription detection, model selection, and provider auth automatically.</p>\n<h3 id=\"what-you-can-tune\">What you can tune</h3>\n<ul>\n<li><strong>Model routing</strong> — which model handles planning, implementation, verification, and specialist skills. The installer sets sensible defaults from your detected subscriptions; override per role when a project needs a different profile.</li>\n<li><strong>Hooks and lifecycle</strong> — whether the Stop-hook auto-continues a plan, iteration caps (500 in ultrawork mode, 100 in normal mode), and how completion is gated.</li>\n<li><strong>Skills</strong> — which skills are active and where they load from.</li>\n<li><strong>Agent roles</strong> — Hephaestus plus explorer, librarian, planner, reviewer, QA, and gate roles. The installer writes the role definitions and model/prompt overrides that Codex can route to.</li>\n</ul>\n<h3 id=\"hooks-amp-lifecycle\">Hooks &amp; lifecycle</h3>\n<p>Hooks never run before approval. On the first launch after install, Codex&#39;s startup review asks you to approve the <code>omo</code> hooks. After every upgrade the hooks show as <strong>Modified</strong> — expected, because the plugin files changed and the previous trust hashes no longer match. Re-approve and the next session runs the new version&#39;s bootstrap.</p>\n<h3 id=\"provider-amp-model-settings\">Provider &amp; model settings</h3>\n<p>Provider and model settings are managed by OmO, not LazyCodex directly. During install, OmO reads the Codex configuration and the bundled <code>model-catalog.json</code> to align model profiles — this is the model routing layer.</p>\n<ul>\n<li>The installer connects provider auth for you. Letting an agent run the install is the recommended path.</li>\n<li>Provider keys are read from the environment. All <code>*_API_KEY</code> and OAuth credentials are secrets — never log or commit them.</li>\n<li>Deeper provider and model tuning beyond the install follows OmO conventions. See the OmO docs for provider environment variables and model resolution rules.</li>\n</ul>\n<blockquote>\n<p>Do not fabricate provider keys. Supply the key your chosen provider documents, via the environment, and let the installer&#39;s routing interpret it.</p>\n</blockquote>\n<h3 id=\"diagnosing-config\">Diagnosing config</h3>\n<p>If something looks pending or degraded, run:</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai doctor\n</code></pre>\n<p>It explains what is misconfigured and why, and points at the specific field to fix. It checks plugin cache, hooks, MCP servers, agent roles, and Codex config state.</p>\n<h3 id=\"re-running-setup\">Re-running setup</h3>\n<p>The installer is idempotent. Re-running <code>npx lazycodex-ai install</code> rewrites the config blocks, agent roles, and bin links on top of what is there, so it is safe to run after editing configuration by hand.</p>\n<p>See the <a href=\"#cli\">CLI reference</a> for every command the installer exposes.</p>\n",
  "deploy.md": "<p>The docs site at <code>lazycodex.ai</code> deploys automatically to Cloudflare Workers. There is no manual publish step for the web — a push to <code>main</code> that touches the web package ships it.</p>\n<h3 id=\"trigger\">Trigger</h3>\n<p>The <code>Web Deploy (Cloudflare Workers)</code> workflow runs on push to <code>main</code> when <code>packages/web/**</code> or the workflow file itself changes, and on manual <code>workflow_dispatch</code>. A concurrency group keyed by ref serializes runs and never cancels an in-flight deploy.</p>\n<h3 id=\"build\">Build</h3>\n<p>Inside <code>packages/web</code>, the prebuild step regenerates <code>lib/docs-content.generated.ts</code> from <code>content/docs/*.md</code>. The site is then built with OpenNext for Cloudflare (<code>pnpm exec opennextjs-cloudflare build</code>).</p>\n<h3 id=\"deploy-2\">Deploy</h3>\n<p><code>cloudflare/wrangler-action@v4</code> runs <code>wrangler deploy</code> (or <code>deploy --env &lt;environment&gt;</code> when an environment is supplied) against the <code>web-production</code> environment, whose URL is <code>https://lazycodex.ai</code>.</p>\n<h3 id=\"post-deploy-smoke-checks\">Post-deploy smoke checks</h3>\n<p>The workflow fails the job if any check breaks:</p>\n<ul>\n<li>Apex <code>https://lazycodex.ai/</code> returns <code>200</code>.</li>\n<li><code>www.lazycodex.ai</code>, <code>lazycodex.dev</code>, and <code>www.lazycodex.dev</code> each return <code>301</code> redirecting to <code>https://lazycodex.ai</code>.</li>\n</ul>\n<p>A PageSpeed Insights pass audits the live URL for Lighthouse 100/100/100/100 across performance, accessibility, best-practices, and SEO, on both mobile and desktop. It is non-blocking here because PSI shared quota throttles frequent CI; the gating Lighthouse check runs in <code>web-ci.yml</code> via real Playwright Chromium.</p>\n<h3 id=\"local-preview\">Local preview</h3>\n<pre><code class=\"language-bash\">cd packages/web\npnpm preview   # opennextjs-cloudflare build &amp;&amp; preview\npnpm deploy    # build &amp;&amp; deploy (requires Cloudflare auth)\n</code></pre>\n<h3 id=\"reading-more\">Reading more</h3>\n<ul>\n<li><a href=\"#skills\">Skills</a> — what the docs site documents.</li>\n<li><a href=\"#configuration\">Configuration</a> — tuning that affects the build.</li>\n</ul>\n",
  "cli.md": "<p>The <code>lazycodex-ai</code> CLI is the entry point for installing and diagnosing the harness. It is meant to be run through <code>npx</code> — never install it globally.</p>\n<h3 id=\"forwarding-to-omo\">Forwarding to OmO</h3>\n<p>The bin reads its arguments and forwards them to <code>oh-my-openagent</code>. The <code>install</code> subcommand is special-cased to lock the Codex platform target; everything else passes through as-is.</p>\n<p><strong>install</strong> expands to:</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai install\n# → npx --yes --package oh-my-openagent omo install --platform=codex\n</code></pre>\n<p>Arguments after <code>install</code> are appended verbatim:</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai install --no-tui --codex-autonomous\n# → npx --yes --package oh-my-openagent omo install --platform=codex --no-tui --codex-autonomous\n</code></pre>\n<p><strong>Other subcommands</strong> forward without the platform lock:</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai &lt;args...&gt;\n# → npx --yes --package oh-my-openagent omo &lt;args...&gt;\n</code></pre>\n<h3 id=\"install\">install</h3>\n<pre><code class=\"language-bash\">npx lazycodex-ai install\n</code></pre>\n<p>Installs the OmO agent harness into Codex: commands, skills, hooks, model routing, and verification defaults in one pass.</p>\n<p>To skip the TUI and let the installer run autonomously:</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai install --no-tui --codex-autonomous\n</code></pre>\n<h3 id=\"dry-run\"><code>--dry-run</code></h3>\n<p>Place <code>--dry-run</code> as the <strong>first</strong> argument to print the resolved <code>npx</code> command without executing it:</p>\n<pre><code class=\"language-bash\">npx lazycodex-ai --dry-run install --no-tui --codex-autonomous\n</code></pre>\n<p>Output:</p>\n<pre><code class=\"language-text\">npx --yes --package oh-my-openagent omo install --platform=codex --no-tui --codex-autonomous\n</code></pre>\n<p><code>--dry-run</code> is stripped before forwarding, so the remaining arguments are interpreted exactly as they would be in a real run. Use it to verify the exact <code>omo</code> call before executing.</p>\n<h3 id=\"doctor\">doctor</h3>\n<pre><code class=\"language-bash\">npx lazycodex-ai doctor\n</code></pre>\n<p>Prints a health report: what is configured, what is missing, and why. Checks plugin cache, hooks, MCP servers, agent roles, and Codex config state. Run this first when a hook is pending, a skill is not loading, or routing looks wrong.</p>\n<h3 id=\"prerequisites\">Prerequisites</h3>\n<ul>\n<li><a href=\"https://nodejs.org\">Node.js</a> — any maintained LTS; <code>npx</code> ships with it. Bun is <strong>not</strong> required for the installer.</li>\n<li>The <a href=\"https://github.com/openai/codex\">OpenAI Codex CLI</a> or the Codex app, logged in.</li>\n</ul>\n<blockquote>\n<p>Do not use <code>npm install -g</code> or <code>bun add -g</code>. Always invoke via <code>npx</code>.</p>\n</blockquote>\n<h3 id=\"marketplace-alternative\">Marketplace alternative</h3>\n<p>As an additive, experimental path you can install from inside Codex: type <code>/plugins</code>, open the <strong>Add Marketplace</strong> tab, and enter <code>https://github.com/code-yeongyu/lazycodex</code>, then install <code>omo</code> from the <code>sisyphuslabs</code> marketplace. Or from the CLI:</p>\n<pre><code class=\"language-bash\">codex plugin marketplace add https://github.com/code-yeongyu/lazycodex\ncodex plugin add omo@sisyphuslabs\n</code></pre>\n<p>Upgrade with <code>codex plugin marketplace upgrade sisyphuslabs</code>. After an upgrade the hooks show as <strong>Modified</strong> — expected, because plugin files changed and the previous trust hashes no longer match. Re-approve and the next session runs the new version&#39;s bootstrap.</p>\n<p>The npx installer above stays the primary path. See <a href=\"#installation\">Installation</a> for the full walkthrough.</p>\n<h3 id=\"exit-behavior\">Exit behavior</h3>\n<p>The bin executes the resolved command with inherited stdio and exits with that command&#39;s status code. If <code>npx</code> itself fails to spawn, it prints the error and exits non-zero.</p>\n<h3 id=\"in-session-commands\">In-session commands</h3>\n<p>Once installed, LazyCodex registers OmO commands inside Codex. These are <code>$command</code> invocations in the Codex input — not shell commands. Syntax and usage flows are collected in the <a href=\"#ulw-plan\">Commands</a> section.</p>\n"
};

export type DocHeading = { level: number; id: string; text: string };
export const DOC_TOC: Record<string, DocHeading[]> = {
  "overview.md": [
    {
      "level": 3,
      "id": "thin-distribution",
      "text": "Thin distribution"
    },
    {
      "level": 3,
      "id": "what-gets-installed",
      "text": "What gets installed"
    },
    {
      "level": 3,
      "id": "where-it-comes-from",
      "text": "Where it comes from"
    },
    {
      "level": 3,
      "id": "what-you-get",
      "text": "What you get"
    },
    {
      "level": 3,
      "id": "remember-these-four",
      "text": "Remember these four"
    },
    {
      "level": 3,
      "id": "the-harness-workflow",
      "text": "The harness workflow"
    },
    {
      "level": 3,
      "id": "how-it-fits-together",
      "text": "How it fits together"
    }
  ],
  "installation.md": [
    {
      "level": 3,
      "id": "prerequisites",
      "text": "Prerequisites"
    },
    {
      "level": 3,
      "id": "install",
      "text": "Install"
    },
    {
      "level": 3,
      "id": "install-from-the-codex-marketplace-experimental",
      "text": "Install from the Codex marketplace (experimental)"
    },
    {
      "level": 3,
      "id": "authentication",
      "text": "Authentication"
    },
    {
      "level": 3,
      "id": "windows",
      "text": "Windows"
    },
    {
      "level": 3,
      "id": "let-an-agent-do-it",
      "text": "Let an agent do it"
    }
  ],
  "recommended-environment.md": [
    {
      "level": 3,
      "id": "operating-system",
      "text": "Operating system"
    },
    {
      "level": 3,
      "id": "before-you-install",
      "text": "Before you install"
    },
    {
      "level": 3,
      "id": "author-recommendations",
      "text": "Author recommendations"
    }
  ],
  "getting-started.md": [
    {
      "level": 3,
      "id": "prerequisites",
      "text": "Prerequisites"
    },
    {
      "level": 3,
      "id": "install",
      "text": "Install"
    },
    {
      "level": 3,
      "id": "authentication",
      "text": "Authentication"
    },
    {
      "level": 3,
      "id": "the-four-commands",
      "text": "The four commands"
    },
    {
      "level": 3,
      "id": "your-first-run",
      "text": "Your first run"
    },
    {
      "level": 3,
      "id": "how-to-choose",
      "text": "How to choose"
    },
    {
      "level": 3,
      "id": "a-typical-session",
      "text": "A typical session"
    }
  ],
  "faq.md": [
    {
      "level": 3,
      "id": "install-amp-environment",
      "text": "Install &amp; environment"
    },
    {
      "level": 3,
      "id": "first-use",
      "text": "First use"
    },
    {
      "level": 3,
      "id": "execution-amp-verification",
      "text": "Execution &amp; verification"
    },
    {
      "level": 3,
      "id": "conflicts-amp-limits",
      "text": "Conflicts &amp; limits"
    }
  ],
  "init-deep.md": [
    {
      "level": 3,
      "id": "what-it-produces",
      "text": "What it produces"
    },
    {
      "level": 3,
      "id": "when-to-run-it",
      "text": "When to run it"
    },
    {
      "level": 3,
      "id": "how-to-use-it",
      "text": "How to use it"
    },
    {
      "level": 3,
      "id": "after-init",
      "text": "After init"
    }
  ],
  "ulw-plan.md": [
    {
      "level": 3,
      "id": "the-flow",
      "text": "The flow"
    },
    {
      "level": 3,
      "id": "output",
      "text": "Output"
    },
    {
      "level": 3,
      "id": "handoff",
      "text": "Handoff"
    }
  ],
  "start-work.md": [
    {
      "level": 3,
      "id": "how-it-works",
      "text": "How it works"
    },
    {
      "level": 3,
      "id": "syntax",
      "text": "Syntax"
    },
    {
      "level": 3,
      "id": "done",
      "text": "Done"
    }
  ],
  "ulw-loop.md": [
    {
      "level": 3,
      "id": "how-it-works",
      "text": "How it works"
    },
    {
      "level": 3,
      "id": "bootstrap",
      "text": "Bootstrap"
    },
    {
      "level": 3,
      "id": "manual-qa-channels",
      "text": "Manual-QA channels"
    },
    {
      "level": 3,
      "id": "syntax",
      "text": "Syntax"
    },
    {
      "level": 3,
      "id": "limits",
      "text": "Limits"
    },
    {
      "level": 3,
      "id": "reading-more",
      "text": "Reading more"
    }
  ],
  "skills.md": [
    {
      "level": 3,
      "id": "commands",
      "text": "Commands"
    },
    {
      "level": 3,
      "id": "skill-index",
      "text": "Skill index"
    },
    {
      "level": 3,
      "id": "skill-highlights",
      "text": "Skill highlights"
    },
    {
      "level": 3,
      "id": "review-work",
      "text": "review-work"
    },
    {
      "level": 3,
      "id": "remove-ai-slops",
      "text": "remove-ai-slops"
    },
    {
      "level": 3,
      "id": "frontend",
      "text": "frontend"
    },
    {
      "level": 3,
      "id": "programming",
      "text": "programming"
    },
    {
      "level": 3,
      "id": "debugging",
      "text": "debugging"
    },
    {
      "level": 3,
      "id": "refactor",
      "text": "refactor"
    },
    {
      "level": 3,
      "id": "visual-qa",
      "text": "visual-qa"
    },
    {
      "level": 3,
      "id": "git-master",
      "text": "git-master"
    },
    {
      "level": 3,
      "id": "ulw-research",
      "text": "ulw-research"
    },
    {
      "level": 3,
      "id": "lsp",
      "text": "LSP"
    },
    {
      "level": 3,
      "id": "ast-grep",
      "text": "AST-grep"
    },
    {
      "level": 3,
      "id": "lsp-setup",
      "text": "lsp-setup"
    },
    {
      "level": 3,
      "id": "rules",
      "text": "rules"
    },
    {
      "level": 3,
      "id": "comment-checker",
      "text": "comment-checker"
    },
    {
      "level": 3,
      "id": "where-skills-live",
      "text": "Where skills live"
    }
  ],
  "ultrawork.md": [
    {
      "level": 3,
      "id": "usage",
      "text": "Usage"
    },
    {
      "level": 3,
      "id": "what-it-enforces",
      "text": "What it enforces"
    },
    {
      "level": 3,
      "id": "relationship-to-ulw-loop",
      "text": "Relationship to $ulw-loop"
    },
    {
      "level": 3,
      "id": "failure-limits",
      "text": "Failure limits"
    },
    {
      "level": 3,
      "id": "evidence-over-hope",
      "text": "Evidence over hope"
    },
    {
      "level": 3,
      "id": "position-among-commands",
      "text": "Position among commands"
    }
  ],
  "discipline-agents.md": [
    {
      "level": 3,
      "id": "what-hephaestus-is",
      "text": "What Hephaestus is"
    },
    {
      "level": 3,
      "id": "installed-roles",
      "text": "Installed roles"
    },
    {
      "level": 3,
      "id": "parent-session-ownership",
      "text": "Parent session ownership"
    },
    {
      "level": 3,
      "id": "the-operating-loop",
      "text": "The operating loop"
    },
    {
      "level": 3,
      "id": "non-goals",
      "text": "Non-goals"
    },
    {
      "level": 3,
      "id": "delegation-and-orchestration",
      "text": "Delegation and orchestration"
    },
    {
      "level": 3,
      "id": "boulder-state",
      "text": "Boulder state"
    },
    {
      "level": 3,
      "id": "where-the-boulder-comes-from",
      "text": "Where the boulder comes from"
    },
    {
      "level": 3,
      "id": "reading-more",
      "text": "Reading more"
    }
  ],
  "model-routing.md": [
    {
      "level": 3,
      "id": "current-baseline",
      "text": "Current baseline"
    },
    {
      "level": 3,
      "id": "what-gets-routed",
      "text": "What gets routed"
    },
    {
      "level": 3,
      "id": "why-role-profiles-exist",
      "text": "Why role profiles exist"
    },
    {
      "level": 3,
      "id": "how-it-fits-the-harness",
      "text": "How it fits the harness"
    },
    {
      "level": 3,
      "id": "provider-auth",
      "text": "Provider auth"
    },
    {
      "level": 3,
      "id": "user-notes",
      "text": "User notes"
    },
    {
      "level": 3,
      "id": "customizing-it",
      "text": "Customizing it"
    }
  ],
  "hooks-lifecycle.md": [
    {
      "level": 3,
      "id": "trigger-matrix",
      "text": "Trigger matrix"
    },
    {
      "level": 3,
      "id": "the-core-mechanism",
      "text": "The core mechanism"
    },
    {
      "level": 3,
      "id": "where-progress-lives",
      "text": "Where progress lives"
    },
    {
      "level": 3,
      "id": "approval-and-trust",
      "text": "Approval and trust"
    },
    {
      "level": 3,
      "id": "evidence-gates",
      "text": "Evidence gates"
    },
    {
      "level": 3,
      "id": "installed-components",
      "text": "Installed components"
    },
    {
      "level": 3,
      "id": "reading-more",
      "text": "Reading more"
    }
  ],
  "git-workflow.md": [
    {
      "level": 3,
      "id": "mode-gate",
      "text": "Mode gate"
    },
    {
      "level": 3,
      "id": "commit-mode",
      "text": "Commit mode"
    },
    {
      "level": 3,
      "id": "rebase-and-merge",
      "text": "Rebase and merge"
    },
    {
      "level": 3,
      "id": "push-safety",
      "text": "Push safety"
    },
    {
      "level": 3,
      "id": "reading-more",
      "text": "Reading more"
    }
  ],
  "tdd.md": [
    {
      "level": 3,
      "id": "the-order",
      "text": "The order"
    },
    {
      "level": 3,
      "id": "the-test-pyramid",
      "text": "The test pyramid"
    },
    {
      "level": 3,
      "id": "deterministic-or-it-is-broken",
      "text": "Deterministic, or it is broken"
    },
    {
      "level": 3,
      "id": "prompt-tests-assert-behavior-not-text",
      "text": "Prompt tests assert behavior, not text"
    },
    {
      "level": 3,
      "id": "the-five-evidence-gates",
      "text": "The five evidence gates"
    },
    {
      "level": 3,
      "id": "reading-more",
      "text": "Reading more"
    }
  ],
  "manual-qa.md": [
    {
      "level": 3,
      "id": "visual-qa",
      "text": "visual-qa"
    },
    {
      "level": 3,
      "id": "review-work",
      "text": "review-work"
    },
    {
      "level": 3,
      "id": "adversarial-classes-and-cleanup",
      "text": "Adversarial classes and cleanup"
    },
    {
      "level": 3,
      "id": "reading-more",
      "text": "Reading more"
    }
  ],
  "configuration.md": [
    {
      "level": 3,
      "id": "zero-config-by-default",
      "text": "Zero-config by default"
    },
    {
      "level": 3,
      "id": "codex-target",
      "text": "Codex target"
    },
    {
      "level": 3,
      "id": "where-config-lives",
      "text": "Where config lives"
    },
    {
      "level": 3,
      "id": "install-flags",
      "text": "Install flags"
    },
    {
      "level": 3,
      "id": "what-you-can-tune",
      "text": "What you can tune"
    },
    {
      "level": 3,
      "id": "hooks-amp-lifecycle",
      "text": "Hooks &amp; lifecycle"
    },
    {
      "level": 3,
      "id": "provider-amp-model-settings",
      "text": "Provider &amp; model settings"
    },
    {
      "level": 3,
      "id": "diagnosing-config",
      "text": "Diagnosing config"
    },
    {
      "level": 3,
      "id": "re-running-setup",
      "text": "Re-running setup"
    }
  ],
  "deploy.md": [
    {
      "level": 3,
      "id": "trigger",
      "text": "Trigger"
    },
    {
      "level": 3,
      "id": "build",
      "text": "Build"
    },
    {
      "level": 3,
      "id": "deploy-2",
      "text": "Deploy"
    },
    {
      "level": 3,
      "id": "post-deploy-smoke-checks",
      "text": "Post-deploy smoke checks"
    },
    {
      "level": 3,
      "id": "local-preview",
      "text": "Local preview"
    },
    {
      "level": 3,
      "id": "reading-more",
      "text": "Reading more"
    }
  ],
  "cli.md": [
    {
      "level": 3,
      "id": "forwarding-to-omo",
      "text": "Forwarding to OmO"
    },
    {
      "level": 3,
      "id": "install",
      "text": "install"
    },
    {
      "level": 3,
      "id": "dry-run",
      "text": "--dry-run"
    },
    {
      "level": 3,
      "id": "doctor",
      "text": "doctor"
    },
    {
      "level": 3,
      "id": "prerequisites",
      "text": "Prerequisites"
    },
    {
      "level": 3,
      "id": "marketplace-alternative",
      "text": "Marketplace alternative"
    },
    {
      "level": 3,
      "id": "exit-behavior",
      "text": "Exit behavior"
    },
    {
      "level": 3,
      "id": "in-session-commands",
      "text": "In-session commands"
    }
  ]
};
