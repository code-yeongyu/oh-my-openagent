import os
import shlex
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, ExecInput
from harbor.models.agent.context import AgentContext


class SisyphusAgent(BaseInstalledAgent):
    """
    Sisyphus agent uses OpenCode with oh-my-opencode plugin.
    """

    @staticmethod
    def name() -> str:
        return "sisyphus"

    @property
    def _install_agent_template_path(self) -> Path:
        return Path(__file__).parent / "install-sisyphus.sh.j2"

    def populate_context_post_run(self, context: AgentContext) -> None:
        pass

    def create_run_agent_commands(self, instruction: str) -> list[ExecInput]:
        escaped_instruction = shlex.quote(instruction)

        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Model name must be in the format provider/model_name")

        provider, _ = self.model_name.split("/", 1)

        env = self._get_provider_env(provider)
        env["OPENCODE_FAKE_VCS"] = "git"

        return [
            ExecInput(
                command=(
                    f"opencode --model {self.model_name} run "
                    f"--agent Sisyphus --format=json {escaped_instruction} "
                    f"2>&1 | tee /logs/agent/sisyphus.txt"
                ),
                env=env,
            )
        ]

    def _get_provider_env(self, provider: str) -> dict[str, str]:
        env = {}
        provider_keys = {
            "amazon-bedrock": [
                "AWS_ACCESS_KEY_ID",
                "AWS_SECRET_ACCESS_KEY",
                "AWS_REGION",
            ],
            "anthropic": ["ANTHROPIC_API_KEY"],
            "azure": ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"],
            "deepseek": ["DEEPSEEK_API_KEY"],
            "github-copilot": ["GITHUB_TOKEN"],
            "google": [
                "GEMINI_API_KEY",
                "GOOGLE_GENERATIVE_AI_API_KEY",
                "GOOGLE_APPLICATION_CREDENTIALS",
                "GOOGLE_CLOUD_PROJECT",
                "GOOGLE_CLOUD_LOCATION",
                "GOOGLE_GENAI_USE_VERTEXAI",
                "GOOGLE_API_KEY",
            ],
            "groq": ["GROQ_API_KEY"],
            "huggingface": ["HF_TOKEN"],
            "llama": ["LLAMA_API_KEY"],
            "mistral": ["MISTRAL_API_KEY"],
            "openai": ["OPENAI_API_KEY"],
            "opencode": [],  # opencode/zen - no API key required
            "xai": ["XAI_API_KEY"],
        }

        keys = provider_keys.get(provider, [])

        for key in keys:
            if key in os.environ:
                env[key] = os.environ[key]

        return env
