/// <reference types="bun-types" />

import { describe, it, expect, afterEach } from "bun:test"
import { createCleanMcpEnvironment, EXCLUDED_ENV_PATTERNS } from "./env-cleaner"

describe("createCleanMcpEnvironment", () => {
  // Store original env to restore after tests
  const originalEnv = { ...process.env }

  afterEach(() => {
    // Restore original environment
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value
    }
  })

  describe("NPM_CONFIG_* filtering", () => {
    it("filters out uppercase NPM_CONFIG_* variables", () => {
      // given
      process.env.NPM_CONFIG_REGISTRY = "https://private.registry.com"
      process.env.NPM_CONFIG_CACHE = "/some/cache/path"
      process.env.NPM_CONFIG_PREFIX = "/some/prefix"
      process.env.PATH = "/usr/bin"

      // when
      const cleanEnv = createCleanMcpEnvironment()

      // then
      expect(cleanEnv.NPM_CONFIG_REGISTRY).toBeUndefined()
      expect(cleanEnv.NPM_CONFIG_CACHE).toBeUndefined()
      expect(cleanEnv.NPM_CONFIG_PREFIX).toBeUndefined()
      expect(cleanEnv.PATH).toBe("/usr/bin")
    })

    it("filters out lowercase npm_config_* variables", () => {
      // given
      process.env.npm_config_registry = "https://private.registry.com"
      process.env.npm_config_cache = "/some/cache/path"
      process.env.npm_config_https_proxy = "http://proxy:8080"
      process.env.npm_config_proxy = "http://proxy:8080"
      process.env.HOME = "/home/user"

      // when
      const cleanEnv = createCleanMcpEnvironment()

      // then
      expect(cleanEnv.npm_config_registry).toBeUndefined()
      expect(cleanEnv.npm_config_cache).toBeUndefined()
      expect(cleanEnv.npm_config_https_proxy).toBeUndefined()
      expect(cleanEnv.npm_config_proxy).toBeUndefined()
      expect(cleanEnv.HOME).toBe("/home/user")
    })
  })

  describe("YARN_* filtering", () => {
    it("filters out YARN_* variables", () => {
      // given
      process.env.YARN_CACHE_FOLDER = "/yarn/cache"
      process.env.YARN_ENABLE_IMMUTABLE_INSTALLS = "true"
      process.env.YARN_REGISTRY = "https://yarn.registry.com"
      process.env.NODE_ENV = "production"

      // when
      const cleanEnv = createCleanMcpEnvironment()

      // then
      expect(cleanEnv.YARN_CACHE_FOLDER).toBeUndefined()
      expect(cleanEnv.YARN_ENABLE_IMMUTABLE_INSTALLS).toBeUndefined()
      expect(cleanEnv.YARN_REGISTRY).toBeUndefined()
      expect(cleanEnv.NODE_ENV).toBe("production")
    })
  })

  describe("PNPM_* filtering", () => {
    it("filters out PNPM_* variables", () => {
      // given
      process.env.PNPM_HOME = "/pnpm/home"
      process.env.PNPM_STORE_DIR = "/pnpm/store"
      process.env.USER = "testuser"

      // when
      const cleanEnv = createCleanMcpEnvironment()

      // then
      expect(cleanEnv.PNPM_HOME).toBeUndefined()
      expect(cleanEnv.PNPM_STORE_DIR).toBeUndefined()
      expect(cleanEnv.USER).toBe("testuser")
    })
  })

  describe("NO_UPDATE_NOTIFIER filtering", () => {
    it("filters out NO_UPDATE_NOTIFIER variable", () => {
      // given
      process.env.NO_UPDATE_NOTIFIER = "1"
      process.env.SHELL = "/bin/bash"

      // when
      const cleanEnv = createCleanMcpEnvironment()

      // then
      expect(cleanEnv.NO_UPDATE_NOTIFIER).toBeUndefined()
      expect(cleanEnv.SHELL).toBe("/bin/bash")
    })
  })

  describe("custom environment overlay", () => {
    it("merges custom env on top of clean process.env", () => {
      // given
      process.env.PATH = "/usr/bin"
      process.env.NPM_CONFIG_REGISTRY = "https://private.registry.com"
      const customEnv = {
        SAFE_CUSTOM_VAR: "custom-value",
        ANOTHER_SAFE_VAR: "another-value",
      }

      // when
      const cleanEnv = createCleanMcpEnvironment(customEnv)

      // then
      expect(cleanEnv.PATH).toBe("/usr/bin")
      expect(cleanEnv.NPM_CONFIG_REGISTRY).toBeUndefined()
      expect(cleanEnv.SAFE_CUSTOM_VAR).toBe("custom-value")
      expect(cleanEnv.ANOTHER_SAFE_VAR).toBe("another-value")
    })

    it("custom env can override process.env values", () => {
      // given
      process.env.NODE_ENV = "development"
      const customEnv = {
        NODE_ENV: "production",
      }

      // when
      const cleanEnv = createCleanMcpEnvironment(customEnv)

      // then
      expect(cleanEnv.NODE_ENV).toBe("production")
    })

    it("filters secret keys from customEnv that would bypass process.env filtering", () => {
      // given - customEnv tries to inject secrets that should be filtered
      process.env.PATH = "/usr/bin"
      const customEnv = {
        MCP_API_KEY: "secret-key-that-should-be-filtered",
        CUSTOM_SECRET: "another-secret",
        SAFE_VAR: "safe-value",
      }

      // when
      const cleanEnv = createCleanMcpEnvironment(customEnv)

      // then - secret keys from customEnv are filtered despite not being in process.env
      expect(cleanEnv.MCP_API_KEY).toBeUndefined()
      expect(cleanEnv.CUSTOM_SECRET).toBeUndefined()
      expect(cleanEnv.SAFE_VAR).toBe("safe-value")
      expect(cleanEnv.PATH).toBe("/usr/bin")
    })
  })

  describe("undefined value handling", () => {
    it("skips undefined values from process.env", () => {
      // given - process.env can have undefined values in TypeScript
      const envWithUndefined = { ...process.env, UNDEFINED_VAR: undefined }
      Object.assign(process.env, envWithUndefined)

      // when
      const cleanEnv = createCleanMcpEnvironment()

      // then - should not throw and should not include undefined values
      expect(cleanEnv.UNDEFINED_VAR).toBeUndefined()
      expect(Object.values(cleanEnv).every((v) => v !== undefined)).toBe(true)
    })
  })

  describe("mixed case handling", () => {
    it("filters both uppercase and lowercase npm config variants", () => {
      // given - pnpm/yarn can set both cases simultaneously
      process.env.NPM_CONFIG_CACHE = "/uppercase/cache"
      process.env.npm_config_cache = "/lowercase/cache"
      process.env.NPM_CONFIG_REGISTRY = "https://uppercase.registry.com"
      process.env.npm_config_registry = "https://lowercase.registry.com"

      // when
      const cleanEnv = createCleanMcpEnvironment()

      // then
      expect(cleanEnv.NPM_CONFIG_CACHE).toBeUndefined()
      expect(cleanEnv.npm_config_cache).toBeUndefined()
      expect(cleanEnv.NPM_CONFIG_REGISTRY).toBeUndefined()
      expect(cleanEnv.npm_config_registry).toBeUndefined()
    })
  })
})

describe("EXCLUDED_ENV_PATTERNS", () => {
  it("contains patterns for npm, yarn, and pnpm configs", () => {
    // given / #when / #then
    expect(EXCLUDED_ENV_PATTERNS.length).toBeGreaterThanOrEqual(4)

    // Test that patterns match expected strings
    const testCases = [
      { pattern: "NPM_CONFIG_REGISTRY", shouldMatch: true },
      { pattern: "npm_config_registry", shouldMatch: true },
      { pattern: "YARN_CACHE_FOLDER", shouldMatch: true },
      { pattern: "PNPM_HOME", shouldMatch: true },
      { pattern: "NO_UPDATE_NOTIFIER", shouldMatch: true },
      { pattern: "GOOGLE_APPLICATION_CREDENTIALS", shouldMatch: true },
      { pattern: "GOOGLE_CLOUD_PROJECT", shouldMatch: true },
      { pattern: "AZURE_CLIENT_ID", shouldMatch: true },
      { pattern: "GCP_SERVICE_ACCOUNT", shouldMatch: true },
      { pattern: "FIREBASE_CONFIG", shouldMatch: true },
      { pattern: "HEROKU_API_KEY", shouldMatch: true },
      { pattern: "DOCKER_AUTH_CONFIG", shouldMatch: true },
      { pattern: "KUBECONFIG", shouldMatch: true },
      { pattern: "VAULT_TOKEN", shouldMatch: true },
      { pattern: "APP_CREDENTIALS", shouldMatch: true },
      { pattern: "PATH", shouldMatch: false },
      { pattern: "HOME", shouldMatch: false },
      { pattern: "NODE_ENV", shouldMatch: false },
    ]

    for (const { pattern, shouldMatch } of testCases) {
      const matches = EXCLUDED_ENV_PATTERNS.some((regex: RegExp) => regex.test(pattern))
      expect(matches).toBe(shouldMatch)
    }
  })
})
describe("secret env var filtering", () => {
  it("filters out ANTHROPIC_API_KEY", () => {
    // given
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-secret"
    process.env.PATH = "/usr/bin"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.ANTHROPIC_API_KEY).toBeUndefined()
    expect(cleanEnv.PATH).toBe("/usr/bin")
  })

  it("filters out AWS_SECRET_ACCESS_KEY", () => {
    // given
    process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"
    process.env.HOME = "/home/user"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(cleanEnv.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(cleanEnv.HOME).toBe("/home/user")
  })

  it("filters out GITHUB_TOKEN", () => {
    // given
    process.env.GITHUB_TOKEN = "ghp_secrettoken123456789"
    process.env.GITHUB_API_TOKEN = "another_secret_token"
    process.env.SHELL = "/bin/bash"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.GITHUB_TOKEN).toBeUndefined()
    expect(cleanEnv.GITHUB_API_TOKEN).toBeUndefined()
    expect(cleanEnv.SHELL).toBe("/bin/bash")
  })

  it("filters out OPENAI_API_KEY", () => {
    // given
    process.env.OPENAI_API_KEY = "sk-secret123456789"
    process.env.LANG = "en_US.UTF-8"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.OPENAI_API_KEY).toBeUndefined()
    expect(cleanEnv.LANG).toBe("en_US.UTF-8")
  })

  it("filters out DATABASE_URL with credentials", () => {
    // given
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/db"
    process.env.DB_PASSWORD = "supersecretpassword"
    process.env.TERM = "xterm-256color"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.DATABASE_URL).toBeUndefined()
    expect(cleanEnv.DB_PASSWORD).toBeUndefined()
    expect(cleanEnv.TERM).toBe("xterm-256color")
  })

  it("filters out exact cloud credential env vars", () => {
    // given
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/gcp-service-account.json"
    process.env.GOOGLE_CLOUD_PROJECT = "demo-project"
    process.env.PATH = "/usr/bin"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined()
    expect(cleanEnv.GOOGLE_CLOUD_PROJECT).toBeUndefined()
    expect(cleanEnv.PATH).toBe("/usr/bin")
  })
})

describe("suffix-based secret filtering", () => {
  it("filters variables ending with _KEY", () => {
    // given
    process.env.MY_API_KEY = "secret-value"
    process.env.SOME_KEY = "another-secret"
    process.env.TMPDIR = "/tmp"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.MY_API_KEY).toBeUndefined()
    expect(cleanEnv.SOME_KEY).toBeUndefined()
    expect(cleanEnv.TMPDIR).toBe("/tmp")
  })

  it("filters variables ending with _SECRET", () => {
    // given
    process.env.AWS_SECRET = "secret-value"
    process.env.JWT_SECRET = "jwt-secret-token"
    process.env.USER = "testuser"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.AWS_SECRET).toBeUndefined()
    expect(cleanEnv.JWT_SECRET).toBeUndefined()
    expect(cleanEnv.USER).toBe("testuser")
  })

  it("filters variables ending with _TOKEN", () => {
    // given
    process.env.ACCESS_TOKEN = "token-value"
    process.env.BEARER_TOKEN = "bearer-token"
    process.env.HOME = "/home/user"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.ACCESS_TOKEN).toBeUndefined()
    expect(cleanEnv.BEARER_TOKEN).toBeUndefined()
    expect(cleanEnv.HOME).toBe("/home/user")
  })

  it("filters variables ending with _PASSWORD", () => {
    // given
    process.env.DB_PASSWORD = "db-password"
    process.env.APP_PASSWORD = "app-secret"
    process.env.NODE_ENV = "production"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.DB_PASSWORD).toBeUndefined()
    expect(cleanEnv.APP_PASSWORD).toBeUndefined()
    expect(cleanEnv.NODE_ENV).toBe("production")
  })

  it("filters variables ending with _CREDENTIAL", () => {
    // given
    process.env.GCP_CREDENTIAL = "json-credential"
    process.env.AZURE_CREDENTIAL = "azure-creds"
    process.env.PWD = "/current/dir"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.GCP_CREDENTIAL).toBeUndefined()
    expect(cleanEnv.AZURE_CREDENTIAL).toBeUndefined()
    expect(cleanEnv.PWD).toBe("/current/dir")
  })

  it("filters variables ending with _API_KEY", () => {
    // given
    // given
    process.env.STRIPE_API_KEY = "sk_live_secret"
    process.env.SENDGRID_API_KEY = "SG.secret"
    process.env.SHELL = "/bin/zsh"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.STRIPE_API_KEY).toBeUndefined()
    expect(cleanEnv.SENDGRID_API_KEY).toBeUndefined()
    expect(cleanEnv.SHELL).toBe("/bin/zsh")
  })

  it("filters variables ending with _CREDENTIALS", () => {
    // given
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/gcp-service-account.json"
    process.env.APP_CREDENTIALS = "service-account"
    process.env.HOME = "/home/user"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined()
    expect(cleanEnv.APP_CREDENTIALS).toBeUndefined()
    expect(cleanEnv.HOME).toBe("/home/user")
  })
})

describe("cloud provider env filtering", () => {
  it("filters cloud provider and infrastructure prefixes without breaking safe vars", () => {
    // given
    process.env.AZURE_CLIENT_ID = "azure-client"
    process.env.GCP_SERVICE_ACCOUNT = "gcp-account"
    process.env.FIREBASE_CONFIG = "firebase-config"
    process.env.HEROKU_API_KEY = "heroku-key"
    process.env.DOCKER_AUTH_CONFIG = '{"auths":{}}'
    process.env.KUBECONFIG = "/tmp/kubeconfig"
    process.env.VAULT_TOKEN_HELPER = "vault-helper"
    process.env.PATH = "/usr/bin"
    process.env.USER = "testuser"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.AZURE_CLIENT_ID).toBeUndefined()
    expect(cleanEnv.GCP_SERVICE_ACCOUNT).toBeUndefined()
    expect(cleanEnv.FIREBASE_CONFIG).toBeUndefined()
    expect(cleanEnv.HEROKU_API_KEY).toBeUndefined()
    expect(cleanEnv.DOCKER_AUTH_CONFIG).toBeUndefined()
    expect(cleanEnv.KUBECONFIG).toBeUndefined()
    expect(cleanEnv.VAULT_TOKEN_HELPER).toBeUndefined()
    expect(cleanEnv.PATH).toBe("/usr/bin")
    expect(cleanEnv.USER).toBe("testuser")
  })
})

describe("safe environment variables preserved", () => {
  it("preserves PATH", () => {
    // given
    process.env.PATH = "/usr/bin:/usr/local/bin"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.PATH).toBe("/usr/bin:/usr/local/bin")
  })

  it("preserves HOME", () => {
    // given
    process.env.HOME = "/home/testuser"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.HOME).toBe("/home/testuser")
  })

  it("preserves SHELL", () => {
    // given
    process.env.SHELL = "/bin/bash"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.SHELL).toBe("/bin/bash")
  })

  it("preserves LANG", () => {
    // given
    process.env.LANG = "en_US.UTF-8"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.LANG).toBe("en_US.UTF-8")
  })

  it("preserves TERM", () => {
    // given
    process.env.TERM = "xterm-256color"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.TERM).toBe("xterm-256color")
  })

  it("preserves TMPDIR", () => {
    // given
    process.env.TMPDIR = "/tmp"

    // when
    const cleanEnv = createCleanMcpEnvironment()

    // then
    expect(cleanEnv.TMPDIR).toBe("/tmp")
})
})
