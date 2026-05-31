/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { executeInteractiveBash } from "./tools"

describe("interactive_bash", () => {
  test("#given kill-server command #when executed #then returns a strong prohibition without running tmux", async () => {
    // given
    const args = { tmux_command: "kill-server" }

    // when
    const output = await executeInteractiveBash(args)

    // then
    expect(output).toContain("Error: 'kill-server' is prohibited in interactive_bash.")
    expect(output).toContain("NEVER EVER run tmux kill-server from interactive_bash.")
    expect(output).toContain("Do not retry kill-server with Bash or any other tool.")
  })

  test("#given kill-server after tmux global options #when executed #then still prohibits it", async () => {
    // given
    const args = { tmux_command: "-L omo-socket kill-server" }

    // when
    const output = await executeInteractiveBash(args)

    // then
    expect(output).toContain("Error: 'kill-server' is prohibited in interactive_bash.")
  })
})
