import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const agentsPath = join(root, "components", "ultrawork", "agents");

async function run() {
  const exported = await import(join(agentsPath, "index.ts"));
  const agents = Object.values(exported);

  function escapeString(str) {
    return JSON.stringify(str);
  }

  function toToml(obj) {
    let toml = "";
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        if (value.includes("\n")) {
          toml += `${key} = """\n${value.replace(/"""/g, '\\"\\"\\"')}"""\n`;
        } else {
          toml += `${key} = ${escapeString(value)}\n`;
        }
      } else if (Array.isArray(value)) {
        toml += `${key} = [${value.map(escapeString).join(", ")}]\n`;
      }
    }
    return toml;
  }

  for (const agent of agents) {
    const tomlStr = toToml(agent);
    writeFileSync(join(agentsPath, `${agent.name}.toml`), tomlStr);
    console.log(`Synced ${agent.name}.toml`);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
