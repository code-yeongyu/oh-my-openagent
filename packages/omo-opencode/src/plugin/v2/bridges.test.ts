import { describe, expect, test } from "bun:test"
import { toV2McpServerConfig } from "./mcp-bridge"
import { renderCommandTemplate } from "./command-bridge"

describe("toV2McpServerConfig", () => {
  test("#given a V1 local server #when converted #then enabled becomes disabled=false", () => {
    // given
    const v1 = {
      type: "local",
      command: ["bun", "run", "server.ts"],
      environment: { KEY: "value" },
      enabled: true,
      timeout: 30000,
    }
    // when
    const config = toV2McpServerConfig(v1)
    // then
    expect(config).toEqual({
      type: "local",
      command: ["bun", "run", "server.ts"],
      environment: { KEY: "value" },
      disabled: false,
      timeout: { execution: 30000, catalog: 30000 },
    })
  })

  test("#given a disabled V1 remote server #when converted #then disabled=true and oauth fields are renamed", () => {
    // given
    const v1 = {
      type: "remote",
      url: "https://mcp.example.com",
      enabled: false,
      oauth: { clientId: "abc", callbackPort: 8080, redirectUri: "https://localhost/cb" },
    }
    // when
    const config = toV2McpServerConfig(v1)
    // then
    expect(config?.type).toBe("remote")
    expect(config?.disabled).toBe(true)
    expect((config as Record<string, unknown>)["oauth"]).toEqual({
      clientId: "abc",
      callback_port: 8080,
      redirect_uri: "https://localhost/cb",
    })
  })

  test("#given a malformed entry without command/url #when converted #then it is rejected", () => {
    // given
    const v1Local = { type: "local", enabled: true }
    const v1Remote = { type: "remote", enabled: true }
    // when / then
    expect(toV2McpServerConfig(v1Local)).toBeNull()
    expect(toV2McpServerConfig(v1Remote)).toBeNull()
  })
})

describe("renderCommandTemplate", () => {
  test("#given a template with argument placeholders #when rendered with args #then placeholders are substituted", () => {
    // given
    const template = "Review {argument} and $ARGUMENTS"
    // when
    const rendered = renderCommandTemplate(template, "src/")
    // then
    expect(rendered).toBe("Review src/ and src/")
  })

  test("#given a template without placeholders #when rendered #then it is unchanged", () => {
    // given
    const template = "Just run the checks."
    // when
    const rendered = renderCommandTemplate(template, "ignored")
    // then
    expect(rendered).toBe("Just run the checks.")
  })
})
