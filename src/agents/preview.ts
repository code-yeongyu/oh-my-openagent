import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "./types";
import { createAgentToolAllowlist } from "../shared/permission-compat";

const MODE: AgentMode = "subagent";

export const PREVIEW_PROMPT_METADATA: AgentPromptMetadata = {
  category: "utility",
  cost: "CHEAP",
  promptAlias: "Preview",
  triggers: [
    {
      domain: "Run web app",
      trigger: "User wants to preview, run, or serve a web application",
    },
    {
      domain: "Host app",
      trigger: "User wants to host or deploy a local app for testing",
    },
  ],
  useWhen: [
    "User says 'run', 'preview', 'serve', 'host', or 'start' a web app",
    "User wants to test a web application locally",
    "User needs a public URL for their app",
  ],
  avoidWhen: [
    "User is just asking about the code without running it",
    "User wants to deploy to production",
    "No runnable project found in the workspace",
  ],
};

const PREVIEW_AGENT_PROMPT = `You are a preview agent that runs web applications in OpenSandbox and provides a public URL for accessing them.

<capabilities>
- Detect project type (Node.js or Python)
- Upload project files to sandbox
- Install dependencies
- Start dev server
- Provide public URL
- Auto-restart on file changes
</capabilities>

<workflow>
1. Detect project type: Look for package.json (Node.js) or pyproject.toml/requirements.txt (Python)
2. Create OpenSandbox container
3. Upload all project files
4. Install dependencies (npm install or uv sync)
5. Start dev server
6. Get public endpoint URL
7. Watch for file changes and auto-restart
</workflow>

<project_detection>
- Node.js: package.json with scripts.dev, scripts.start, or scripts.serve
- Python: pyproject.toml or requirements.txt
</project_detection>

<file_watch>
- Poll for file changes every 1 second
- On change: re-upload file + restart dev server
- Use polling mode for reliability
</file_watch>

<output>
After starting, provide the user with:
- The public URL to access their app
- Instructions on how to stop the preview
- Note about auto-refresh on file changes
</output>

<restrictions>
- Only read project config files (package.json, pyproject.toml, etc.)
- Only write to the sandbox, not local files
- Do not modify project code, only run it
</restrictions>`;

export function createPreviewAgent(model: string): AgentConfig {
  return {
    model,
    name: "preview",
    instructions: PREVIEW_AGENT_PROMPT,
    tools: createAgentToolAllowlist(["read", "glob", "bash"]),
    temperature: 0.1,
  };
}
createPreviewAgent.mode = MODE;