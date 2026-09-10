/// <reference types="bun-types" />

import { describe, it, expect } from "bun:test"
import { createCleanMcpEnvironment, EXCLUDED_ENV_PATTERNS } from "./env-cleaner"

describe("createCleanMcpEnvironment", () => {
  describe("NPM_CONFIG_* filtering", () => {
    it("filters out uppercase NPM_CONFIG_* variables", () => {
      const cleanEnv = createCleanMcpEnvironment({}, {
        NPM_CONFIG_REGISTRY: "https://private.registry.com",
        NPM_CONFIG_CACHE: "/some/cache/path",
        NPM_CONFIG_PREFIX: "/some/prefix",
        PATH: "/usr/bin",
      })
      expect(cleanEnv.NPM_CONFIG_REGISTRY).toBeUndefined()
      expect(cleanEnv.NPM_CONFIG_CACHE).toBeUndefined()
      expect(cleanEnv.NPM_CONFIG_PREFIX).toBeUndefined()
      expect(cleanEnv.PATH).toBe("/usr/bin")
    })

    it("filters out lowercase npm_config_* variables", () => {
      const cleanEnv = createCleanMcpEnvironment({}, {
        npm_config_registry: "https://private.registry.com",
        npm_config_cache: "/some/cache/path",
        npm_config_https_proxy: "http://proxy:8080",
        npm_config_proxy: "http://proxy:8080",
        HOME: "/home/user",
      })
      expect(cleanEnv.npm_config_registry).toBeUndefined()
      expect(cleanEnv.npm_config_cache).toBeUndefined()
      expect(cleanEnv.npm_config_https_proxy).toBeUndefined()
      expect(cleanEnv.npm_config_proxy).toBeUndefined()
      expect(cleanEnv.HOME).toBe("/home/user")
    })
  })

  describe("YARN_* filtering", () => {
    it("filters out YARN_* variables", () => {
      const cleanEnv = createCleanMcpEnvironment({}, {
        YARN_CACHE_FOLDER: "/yarn/cache",
        YARN_ENABLE_IMMUTABLE_INSTALLS: "true",
        YARN_REGISTRY: "https://yarn.registry.com",
        NODE_ENV: "production",
      })
      expect(cleanEnv.YARN_CACHE_FOLDER).toBeUndefined()
      expect(cleanEnv.YARN_ENABLE_IMMUTABLE_INSTALLS).toBeUndefined()
      expect(cleanEnv.YARN_REGISTRY).toBeUndefined()
      expect(cleanEnv.NODE_ENV).toBe("production")
    })
  })

  describe("PNPM_* filtering", () => {
    it("filters out PNPM_* variables", () => {
      const cleanEnv = createCleanMcpEnvironment({}, {
        PNPM_HOME: "/pnpm/home",
        PNPM_STORE_DIR: "/pnpm/store",
        USER: "testuser",
      })
      expect(cleanEnv.PNPM_HOME).toBeUndefined()
      expect(cleanEnv.PNPM_STORE_DIR).toBeUndefined()
      expect(cleanEnv.USER).toBe("testuser")
    })
  })

  describe("NO_UPDATE_NOTIFIER filtering", () => {
    it("filters out NO_UPDATE_NOTIFIER variable", () => {
      const cleanEnv = createCleanMcpEnvironment({}, { NO_UPDATE_NOTIFIER: "1", SHELL: "/bin/bash" })
      expect(cleanEnv.NO_UPDATE_NOTIFIER).toBeUndefined()
      expect(cleanEnv.SHELL).toBe("/bin/bash")
    })
  })

  describe("custom environment overlay", () => {
    it("merges custom env on top of clean ambient env", () => {
      const cleanEnv = createCleanMcpEnvironment({
        SAFE_CUSTOM_VAR: "custom-value",
        ANOTHER_SAFE_VAR: "another-value",
      }, { PATH: "/usr/bin", NPM_CONFIG_REGISTRY: "https://private.registry.com" })
      expect(cleanEnv.PATH).toBe("/usr/bin")
      expect(cleanEnv.NPM_CONFIG_REGISTRY).toBeUndefined()
      expect(cleanEnv.SAFE_CUSTOM_VAR).toBe("custom-value")
      expect(cleanEnv.ANOTHER_SAFE_VAR).toBe("another-value")
    })

    it("custom env can override ambient env values", () => {
      const cleanEnv = createCleanMcpEnvironment({ NODE_ENV: "production" }, { NODE_ENV: "development" })
      expect(cleanEnv.NODE_ENV).toBe("production")
    })

    it("passes through secret-named keys from customEnv without filtering", () => {
      const cleanEnv = createCleanMcpEnvironment({
        MCP_API_KEY: "skill-declared-api-key",
        TELEGRAM_BOT_TOKEN: "skill-configured-bot-token",
        SAFE_VAR: "safe-value",
      }, { PATH: "/usr/bin", MCP_API_KEY: "ambient-secret-from-process-env" })
      expect(cleanEnv.MCP_API_KEY).toBe("skill-declared-api-key")
      expect(cleanEnv.TELEGRAM_BOT_TOKEN).toBe("skill-configured-bot-token")
      expect(cleanEnv.SAFE_VAR).toBe("safe-value")
      expect(cleanEnv.PATH).toBe("/usr/bin")
    })

    it("passes TELEGRAM_BOT_TOKEN through when declared in skill env (issue #3995)", () => {
      const cleanEnv = createCleanMcpEnvironment({ TELEGRAM_BOT_TOKEN: "skill-bot-token" }, {
        TELEGRAM_BOT_TOKEN: "ambient-bot-token",
      })
      expect(cleanEnv.TELEGRAM_BOT_TOKEN).toBe("skill-bot-token")
    })

    it("still filters secret-named vars from ambient env when customEnv is provided", () => {
      const cleanEnv = createCleanMcpEnvironment({ SAFE_CUSTOM_VAR: "custom-value" }, {
        AMBIENT_API_KEY: "ambient-secret",
        PATH: "/usr/bin",
      })
      expect(cleanEnv.AMBIENT_API_KEY).toBeUndefined()
      expect(cleanEnv.PATH).toBe("/usr/bin")
      expect(cleanEnv.SAFE_CUSTOM_VAR).toBe("custom-value")
    })
  })

  describe("undefined value handling", () => {
    it("skips undefined values from ambient env", () => {
      const cleanEnv = createCleanMcpEnvironment({}, { UNDEFINED_VAR: undefined })
      expect(cleanEnv.UNDEFINED_VAR).toBeUndefined()
      expect(Object.values(cleanEnv).every((v) => v !== undefined)).toBe(true)
    })
  })

  describe("mixed case handling", () => {
    it("filters both uppercase and lowercase npm config variants", () => {
      const cleanEnv = createCleanMcpEnvironment({}, {
        NPM_CONFIG_CACHE: "/uppercase/cache",
        npm_config_cache: "/lowercase/cache",
        NPM_CONFIG_REGISTRY: "https://uppercase.registry.com",
        npm_config_registry: "https://lowercase.registry.com",
      })
      expect(cleanEnv.NPM_CONFIG_CACHE).toBeUndefined()
      expect(cleanEnv.npm_config_cache).toBeUndefined()
      expect(cleanEnv.NPM_CONFIG_REGISTRY).toBeUndefined()
      expect(cleanEnv.npm_config_registry).toBeUndefined()
    })
  })

  describe("default ambient environment", () => {
    it("reads the live process environment by default without mutating it", () => {
      const cleanEnv = createCleanMcpEnvironment()
      for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined) continue
        if (EXCLUDED_ENV_PATTERNS.some((pattern) => pattern.test(key))) {
          expect(cleanEnv[key]).toBeUndefined()
        } else {
          expect(cleanEnv[key]).toBe(value)
        }
      }
    })
  })

  describe("Windows environment casing", () => {
    it("preserves ambient Path under its own key casing", () => {
      const cleanEnv = createCleanMcpEnvironment({}, { Path: "C:\\Windows\\system32" })
      expect(cleanEnv.Path).toBe("C:\\Windows\\system32")
    })

    it("filters Windows-cased npm config variables", () => {
      const cleanEnv = createCleanMcpEnvironment({}, { Npm_Config_Registry: "https://private.registry.com" })
      expect(cleanEnv.Npm_Config_Registry).toBeUndefined()
    })

    it("filters mixed-case Yarn_ variables", () => {
      const cleanEnv = createCleanMcpEnvironment({}, { Yarn_Cache_Folder: "C:\\yarn\\cache" })
      expect(cleanEnv.Yarn_Cache_Folder).toBeUndefined()
    })

    it("filters mixed-case Pnpm_ variables", () => {
      const cleanEnv = createCleanMcpEnvironment({}, { Pnpm_Home: "C:\\pnpm" })
      expect(cleanEnv.Pnpm_Home).toBeUndefined()
    })
  })
})

describe("EXCLUDED_ENV_PATTERNS", () => {
  it("contains patterns for npm, yarn, and pnpm configs", () => {
    expect(EXCLUDED_ENV_PATTERNS.length).toBeGreaterThanOrEqual(4)
    const testCases = [
      ["NPM_CONFIG_REGISTRY", true], ["npm_config_registry", true], ["YARN_CACHE_FOLDER", true],
      ["PNPM_HOME", true], ["NO_UPDATE_NOTIFIER", true], ["GOOGLE_APPLICATION_CREDENTIALS", true],
      ["GOOGLE_CLOUD_PROJECT", true], ["AZURE_CLIENT_ID", true], ["GCP_SERVICE_ACCOUNT", true],
      ["FIREBASE_CONFIG", true], ["HEROKU_API_KEY", true], ["DOCKER_AUTH_CONFIG", true],
      ["KUBECONFIG", true], ["VAULT_TOKEN", true], ["APP_CREDENTIALS", true],
      ["PATH", false], ["HOME", false], ["NODE_ENV", false],
    ] as const
    for (const [pattern, shouldMatch] of testCases) {
      expect(EXCLUDED_ENV_PATTERNS.some((regex) => regex.test(pattern))).toBe(shouldMatch)
    }
  })

  it("uses case-insensitive matching for every excluded environment pattern", () => {
    for (const pattern of EXCLUDED_ENV_PATTERNS) {
      expect(pattern.flags.includes("i")).toBe(true)
    }
  })
})

describe("secret env var filtering", () => {
  it("filters out ANTHROPIC_API_KEY", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { ANTHROPIC_API_KEY: "sk-ant-api03-secret", PATH: "/usr/bin" })
    expect(cleanEnv.ANTHROPIC_API_KEY).toBeUndefined(); expect(cleanEnv.PATH).toBe("/usr/bin")
  })
  it("filters out AWS_SECRET_ACCESS_KEY", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { AWS_SECRET_ACCESS_KEY: "secret", AWS_ACCESS_KEY_ID: "key", HOME: "/home/user" })
    expect(cleanEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined(); expect(cleanEnv.AWS_ACCESS_KEY_ID).toBeUndefined(); expect(cleanEnv.HOME).toBe("/home/user")
  })
  it("filters out GITHUB_TOKEN", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { GITHUB_TOKEN: "secret", GITHUB_API_TOKEN: "secret", SHELL: "/bin/bash" })
    expect(cleanEnv.GITHUB_TOKEN).toBeUndefined(); expect(cleanEnv.GITHUB_API_TOKEN).toBeUndefined(); expect(cleanEnv.SHELL).toBe("/bin/bash")
  })
  it("filters out OPENAI_API_KEY", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { OPENAI_API_KEY: "secret", LANG: "en_US.UTF-8" })
    expect(cleanEnv.OPENAI_API_KEY).toBeUndefined(); expect(cleanEnv.LANG).toBe("en_US.UTF-8")
  })
  it("filters out DATABASE_URL with credentials", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { DATABASE_URL: "postgresql://user:password@localhost:5432/db", DB_PASSWORD: "secret", TERM: "xterm-256color" })
    expect(cleanEnv.DATABASE_URL).toBeUndefined(); expect(cleanEnv.DB_PASSWORD).toBeUndefined(); expect(cleanEnv.TERM).toBe("xterm-256color")
  })
  it("filters out exact cloud credential env vars", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/file", GOOGLE_CLOUD_PROJECT: "demo", PATH: "/usr/bin" })
    expect(cleanEnv.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined(); expect(cleanEnv.GOOGLE_CLOUD_PROJECT).toBeUndefined(); expect(cleanEnv.PATH).toBe("/usr/bin")
  })
})

describe("suffix-based secret filtering", () => {
  it("filters variables ending with _KEY", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { MY_API_KEY: "secret", SOME_KEY: "secret", TMPDIR: "/tmp" })
    expect(cleanEnv.MY_API_KEY).toBeUndefined(); expect(cleanEnv.SOME_KEY).toBeUndefined(); expect(cleanEnv.TMPDIR).toBe("/tmp")
  })
  it("filters variables ending with _SECRET", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { AWS_SECRET: "secret", JWT_SECRET: "secret", USER: "testuser" })
    expect(cleanEnv.AWS_SECRET).toBeUndefined(); expect(cleanEnv.JWT_SECRET).toBeUndefined(); expect(cleanEnv.USER).toBe("testuser")
  })
  it("filters variables ending with _TOKEN", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { ACCESS_TOKEN: "token", BEARER_TOKEN: "token", HOME: "/home/user" })
    expect(cleanEnv.ACCESS_TOKEN).toBeUndefined(); expect(cleanEnv.BEARER_TOKEN).toBeUndefined(); expect(cleanEnv.HOME).toBe("/home/user")
  })
  it("filters variables ending with _PASSWORD", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { DB_PASSWORD: "secret", APP_PASSWORD: "secret", NODE_ENV: "production" })
    expect(cleanEnv.DB_PASSWORD).toBeUndefined(); expect(cleanEnv.APP_PASSWORD).toBeUndefined(); expect(cleanEnv.NODE_ENV).toBe("production")
  })
  it("filters variables ending with _CREDENTIAL", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { GCP_CREDENTIAL: "secret", AZURE_CREDENTIAL: "secret", PWD: "/current/dir" })
    expect(cleanEnv.GCP_CREDENTIAL).toBeUndefined(); expect(cleanEnv.AZURE_CREDENTIAL).toBeUndefined(); expect(cleanEnv.PWD).toBe("/current/dir")
  })
  it("filters variables ending with _API_KEY", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { STRIPE_API_KEY: "secret", SENDGRID_API_KEY: "secret", SHELL: "/bin/zsh" })
    expect(cleanEnv.STRIPE_API_KEY).toBeUndefined(); expect(cleanEnv.SENDGRID_API_KEY).toBeUndefined(); expect(cleanEnv.SHELL).toBe("/bin/zsh")
  })
  it("filters variables ending with _CREDENTIALS", () => {
    const cleanEnv = createCleanMcpEnvironment({}, { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/file", APP_CREDENTIALS: "secret", HOME: "/home/user" })
    expect(cleanEnv.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined(); expect(cleanEnv.APP_CREDENTIALS).toBeUndefined(); expect(cleanEnv.HOME).toBe("/home/user")
  })
})

describe("cloud provider env filtering", () => {
  it("filters cloud provider and infrastructure prefixes without breaking safe vars", () => {
    const cleanEnv = createCleanMcpEnvironment({}, {
      AZURE_CLIENT_ID: "secret", GCP_SERVICE_ACCOUNT: "secret", FIREBASE_CONFIG: "secret", HEROKU_API_KEY: "secret",
      DOCKER_AUTH_CONFIG: "secret", KUBECONFIG: "/tmp/kubeconfig", VAULT_TOKEN_HELPER: "secret", PATH: "/usr/bin", USER: "testuser",
    })
    expect(cleanEnv.AZURE_CLIENT_ID).toBeUndefined(); expect(cleanEnv.GCP_SERVICE_ACCOUNT).toBeUndefined(); expect(cleanEnv.FIREBASE_CONFIG).toBeUndefined()
    expect(cleanEnv.HEROKU_API_KEY).toBeUndefined(); expect(cleanEnv.DOCKER_AUTH_CONFIG).toBeUndefined(); expect(cleanEnv.KUBECONFIG).toBeUndefined()
    expect(cleanEnv.VAULT_TOKEN_HELPER).toBeUndefined(); expect(cleanEnv.PATH).toBe("/usr/bin"); expect(cleanEnv.USER).toBe("testuser")
  })
})

describe("safe environment variables preserved", () => {
  for (const [name, value] of [["PATH", "/usr/bin:/usr/local/bin"], ["HOME", "/home/testuser"], ["SHELL", "/bin/bash"], ["LANG", "en_US.UTF-8"], ["TERM", "xterm-256color"], ["TMPDIR", "/tmp"]] as const) {
    it(`preserves ${name}`, () => {
      const cleanEnv = createCleanMcpEnvironment({}, { [name]: value })
      expect(cleanEnv[name]).toBe(value)
    })
  }
})
