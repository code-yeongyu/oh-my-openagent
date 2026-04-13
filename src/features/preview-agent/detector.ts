import type { ProjectConfig, ProjectType } from "./types"
import { readFile, access } from "fs/promises"
import { join } from "path"

export async function detectProjectType(
  rootDir: string
): Promise<ProjectConfig | null> {
  try {
    const packageJsonPath = join(rootDir, "package.json")
    const packageJsonContent = await readFile(packageJsonPath, "utf-8")
    const pkg = JSON.parse(packageJsonContent)

    const startCommand =
      pkg.scripts?.dev ||
      pkg.scripts?.start ||
      pkg.scripts?.serve ||
      "npm run dev"

    const port = parseInt(process.env.PORT || "") || 3000

    return {
      type: "node",
      rootDir,
      startCommand,
      port,
      dependenciesInstalled: false,
    }
  } catch {
    // No package.json, try Python
  }

  try {
    const pyprojectPath = join(rootDir, "pyproject.toml")
    const requirementsPath = join(rootDir, "requirements.txt")

    let pythonDeps = false
    try {
      await access(requirementsPath)
      pythonDeps = true
    } catch {
      try {
        await access(pyprojectPath)
        pythonDeps = true
      } catch {
        // No python files
      }
    }

    if (pythonDeps) {
      let startCommand = "python main.py"
      let port = 8000

      try {
        const pyproject = await readFile(pyprojectPath, "utf-8")
        const serverMatch = pyproject.match(/\[tool\.uv\]\s*port\s*=\s*(\d+)/)
        if (serverMatch) {
          port = parseInt(serverMatch[1])
        }
      } catch {
        // ignore
      }

      return {
        type: "python",
        rootDir,
        startCommand,
        port,
        dependenciesInstalled: false,
      }
    }
  } catch {
    // No python project
  }

  return null
}

export function getInstallCommand(projectType: ProjectType): string {
  switch (projectType) {
    case "node":
      return "npm install"
    case "python":
      return "uv sync"
  }
}

export function getImage(projectType: ProjectType): "node:20" | "python:3.11" {
  switch (projectType) {
    case "node":
      return "node:20"
    case "python":
      return "python:3.11"
  }
}

export function getInstallCommand(projectType: ProjectType): string {
  switch (projectType) {
    case "node":
      return "npm install"
    case "python":
      return "uv sync"
  }
}

export function getImage(projectType: ProjectType): "node:20" | "python:3.11" {
  switch (projectType) {
    case "node":
      return "node:20"
    case "python":
      return "python:3.11"
  }
}