# CLI Stack — cobra + slog + caarlos0/env + signal handling

The canonical Go CLI skeleton. `cobra` is the de facto framework — Kubernetes, Docker CLI, Helm, GitHub CLI, gh, Hugo all use it. Use it.

---

## Toolchain

```bash
go install github.com/spf13/cobra-cli@latest
cobra-cli init mytool
cobra-cli add server
cobra-cli add migrate
```

`cobra-cli` scaffolds the `cmd/` package. Edit the result; do not regenerate.

---

## Layout

```
mytool/
├── go.mod
├── main.go                  # ≤ 30 LOC, calls cmd.Execute
├── cmd/
│   ├── root.go              # rootCmd, persistent flags, slog setup
│   ├── server.go            # `mytool server` subcommand
│   ├── migrate.go           # `mytool migrate` subcommand
│   └── version.go           # `mytool version` — auto-injected version
├── internal/
│   ├── config/
│   └── server/
└── Taskfile.yml
```

---

## `main.go`

```go
package main

import (
    "context"
    "log/slog"
    "os"
    "os/signal"
    "syscall"

    "github.com/your-org/mytool/cmd"
)

func main() {
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    if err := cmd.Execute(ctx); err != nil {
        slog.Error("fatal", slog.Any("err", err))
        os.Exit(1)
    }
}
```

`signal.NotifyContext` (Go 1.16+) gives every subcommand a ctx that cancels on Ctrl-C. Subcommands plumb the ctx into their workers.

---

## `cmd/root.go`

```go
package cmd

import (
    "context"
    "log/slog"
    "os"

    "github.com/spf13/cobra"
)

var (
    verbose    bool
    logFormat  string
    configPath string
)

var rootCmd = &cobra.Command{
    Use:   "mytool",
    Short: "Short description of mytool",
    Long:  `Long description, prose; cobra wraps it for --help.`,
    PersistentPreRunE: func(c *cobra.Command, args []string) error {
        return setupLogger()
    },
    SilenceUsage:  true,  // don't print --help on every error
    SilenceErrors: true,  // we log them ourselves in Execute
}

func init() {
    rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false,
        "enable debug logging")
    rootCmd.PersistentFlags().StringVar(&logFormat, "log-format", "text",
        "log format: text or json")
    rootCmd.PersistentFlags().StringVarP(&configPath, "config", "c", "",
        "path to config file (optional)")
}

func Execute(ctx context.Context) error {
    return rootCmd.ExecuteContext(ctx)
}

func setupLogger() error {
    level := slog.LevelInfo
    if verbose { level = slog.LevelDebug }
    opts := &slog.HandlerOptions{Level: level}

    var h slog.Handler
    switch logFormat {
    case "json":
        h = slog.NewJSONHandler(os.Stderr, opts)
    case "text":
        h = slog.NewTextHandler(os.Stderr, opts)
    default:
        return fmt.Errorf("invalid log-format %q", logFormat)
    }
    slog.SetDefault(slog.New(h))
    return nil
}
```

Notes:

- `RunE` / `PersistentPreRunE` (the `E` variants) return errors. Use these; never use `Run` (no error return, encourages `log.Fatal`).
- `SilenceUsage: true` + `SilenceErrors: true` together: cobra stops printing the full `--help` on every command failure (the default behavior is rude in production scripts).
- `ExecuteContext` (cobra 1.8+) plumbs the ctx into every subcommand's `cmd.Context()`.

---

## `cmd/server.go`

```go
package cmd

import (
    "log/slog"

    "github.com/spf13/cobra"
    "github.com/your-org/mytool/internal/server"
)

var (
    serverAddr string
)

var serverCmd = &cobra.Command{
    Use:   "server",
    Short: "Run the HTTP server",
    RunE: func(c *cobra.Command, args []string) error {
        ctx := c.Context()
        slog.InfoContext(ctx, "starting", slog.String("addr", serverAddr))
        return server.Run(ctx, serverAddr)
    },
}

func init() {
    serverCmd.Flags().StringVar(&serverAddr, "addr", ":8080",
        "listen address")
    rootCmd.AddCommand(serverCmd)
}
```

The subcommand is a thin shim — flags + log line + delegate to `internal/server`. Anything bigger violates the 250-LOC ceiling and belongs in `internal/`.

---

## Subcommands with arguments

```go
var migrateUpCmd = &cobra.Command{
    Use:   "up [N]",
    Short: "Apply N migrations (default: all)",
    Args:  cobra.MaximumNArgs(1),
    RunE: func(c *cobra.Command, args []string) error {
        n := -1  // all
        if len(args) == 1 {
            var err error
            n, err = strconv.Atoi(args[0])
            if err != nil {
                return fmt.Errorf("invalid N: %w", err)
            }
        }
        return migrate.Up(c.Context(), n)
    },
}
```

Use cobra's argument validators (`cobra.ExactArgs`, `cobra.MaximumNArgs`, `cobra.OnlyValidArgs`). They produce clean help text.

---

## Flag types — typed, not strings

```go
// GOOD
serverCmd.Flags().DurationVar(&timeout, "timeout", 30*time.Second, "request timeout")
serverCmd.Flags().IntVar(&port, "port", 8080, "port")
serverCmd.Flags().StringSliceVar(&hosts, "host", nil, "allowed hosts (repeatable)")

// BAD — manual parsing
serverCmd.Flags().StringVar(&timeoutStr, "timeout", "30s", "")
// ...then later: time.ParseDuration(timeoutStr)
```

`pflag` (cobra's flag lib) has typed variants for every common type. Use them; the parsing and error messages are free.

---

## Bind flags to env vars

cobra + viper is overkill for env binding. Use `caarlos0/env/v11`:

```go
type ServerOpts struct {
    Addr    string        `env:"ADDR"    envDefault:":8080"`
    Timeout time.Duration `env:"TIMEOUT" envDefault:"30s"`
}

var opts ServerOpts

var serverCmd = &cobra.Command{
    Use: "server",
    PersistentPreRunE: func(c *cobra.Command, args []string) error {
        // 1. Parse env first.
        if err := env.Parse(&opts); err != nil { return err }
        // 2. Flags override env if explicitly set.
        if c.Flags().Changed("addr") {
            opts.Addr, _ = c.Flags().GetString("addr")
        }
        return nil
    },
    RunE: func(c *cobra.Command, args []string) error {
        return server.Run(c.Context(), opts)
    },
}

func init() {
    serverCmd.Flags().String("addr", "", "listen address (env: ADDR)")
    serverCmd.Flags().Duration("timeout", 0, "request timeout (env: TIMEOUT)")
    rootCmd.AddCommand(serverCmd)
}
```

Precedence: **flag (if set) > env > default**. Document the env var in the flag usage string.

---

## Version subcommand — build-injected

```go
// cmd/version.go
package cmd

import (
    "fmt"
    "runtime/debug"

    "github.com/spf13/cobra"
)

// Set by -ldflags at build time, falls back to debug.BuildInfo.
var (
    version = ""
    commit  = ""
    date    = ""
)

var versionCmd = &cobra.Command{
    Use:   "version",
    Short: "Print version",
    Run: func(c *cobra.Command, args []string) {
        v, c2, d := resolveVersion()
        fmt.Printf("mytool %s (commit %s, built %s)\n", v, c2, d)
    },
}

func resolveVersion() (string, string, string) {
    if version != "" { return version, commit, date }
    info, ok := debug.ReadBuildInfo()
    if !ok { return "dev", "unknown", "unknown" }

    var vcs, hash, time string
    for _, s := range info.Settings {
        switch s.Key {
        case "vcs.revision": hash = s.Value
        case "vcs.time":     time = s.Value
        case "vcs":          vcs  = s.Value
        }
    }
    return info.Main.Version, hash, time + " (" + vcs + ")"
}

func init() { rootCmd.AddCommand(versionCmd) }
```

Build with version injection:

```bash
go build \
  -ldflags="-X 'github.com/your-org/mytool/cmd.version=v1.2.3' -X 'github.com/your-org/mytool/cmd.commit=$(git rev-parse --short HEAD)' -X 'github.com/your-org/mytool/cmd.date=$(date -u +%Y-%m-%dT%H:%M:%SZ)'" \
  -o bin/mytool ./
```

The `debug.BuildInfo` fallback means a `go install`'d binary also has version info — no manual `-ldflags` needed.

---

## Shell completions

```go
var completionCmd = &cobra.Command{
    Use:                   "completion [bash|zsh|fish|powershell]",
    Short:                 "Generate shell completion",
    Args:                  cobra.ExactValidArgs(1),
    ValidArgs:             []string{"bash", "zsh", "fish", "powershell"},
    DisableFlagsInUseLine: true,
    RunE: func(c *cobra.Command, args []string) error {
        switch args[0] {
        case "bash":       return rootCmd.GenBashCompletionV2(os.Stdout, true)
        case "zsh":        return rootCmd.GenZshCompletion(os.Stdout)
        case "fish":       return rootCmd.GenFishCompletion(os.Stdout, true)
        case "powershell": return rootCmd.GenPowerShellCompletion(os.Stdout)
        }
        return nil
    },
}

func init() { rootCmd.AddCommand(completionCmd) }
```

User:

```bash
mytool completion zsh > "${fpath[1]}/_mytool"
```

---

## Interactive prompts — `huh` from charm

For prompts/forms (`Are you sure?`, "Pick an environment", multi-field forms):

```go
import "github.com/charmbracelet/huh"

var confirm bool
err := huh.NewConfirm().
    Title("Apply migrations to PRODUCTION?").
    Affirmative("Yes, do it").
    Negative("Abort").
    Value(&confirm).
    Run()
```

`huh` replaces `survey` (which is no longer maintained). It composes with `lipgloss` for styling.

---

## Progress / spinners

```go
import "github.com/charmbracelet/huh/spinner"

err := spinner.New().Title("Fetching...").Action(func() {
    // long-running work
}).Run()
```

For determinate progress (downloads, batch processing), use `vbauerster/mpb/v8`:

```go
import "github.com/vbauerster/mpb/v8"

p := mpb.New(mpb.WithWidth(60))
bar := p.AddBar(int64(total), /* decorators */)
for i := 0; i < total; i++ {
    work()
    bar.Increment()
}
p.Wait()
```

---

## Output — JSON vs text

Honor `--output json` for any CLI that scripts will parse:

```go
var outputFmt string

rootCmd.PersistentFlags().StringVar(&outputFmt, "output", "text",
    "output format: text or json")

func render(v any) error {
    switch outputFmt {
    case "json":
        enc := json.NewEncoder(os.Stdout)
        enc.SetIndent("", "  ")
        return enc.Encode(v)
    case "text":
        return renderText(v)
    default:
        return fmt.Errorf("invalid --output %q", outputFmt)
    }
}
```

The `text` format uses `lipgloss` tables or `aquasecurity/table` for nicely-aligned columns. The `json` format is for `jq`-style piping.

---

## Error semantics

- Return errors from `RunE`. Cobra catches them and the `Execute` wrapper logs + exits non-zero.
- `os.Exit(1)` should appear **only in `main.go`**. Anywhere else means a subcommand cannot be tested.
- For graceful early termination ("user cancelled"), return a sentinel and check it in `Execute`:
  ```go
  var ErrCancelled = errors.New("cancelled by user")
  // ... return ErrCancelled
  // in main:
  if errors.Is(err, cmd.ErrCancelled) { os.Exit(130) }  // 128 + SIGINT
  ```

---

## Testing CLI commands

```go
func TestServerCmd_runs_with_default_addr(t *testing.T) {
    // Given
    buf := &bytes.Buffer{}
    rootCmd.SetOut(buf)
    rootCmd.SetErr(buf)
    rootCmd.SetArgs([]string{"server", "--addr", ":0"})

    // When
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()
    err := rootCmd.ExecuteContext(ctx)

    // Then
    require.NoError(t, err)
    require.Contains(t, buf.String(), "starting")
}
```

`SetArgs` + `ExecuteContext` is the canonical pattern. Bind a ctx with a short deadline for tests that would otherwise block.

---

## Sources

- cobra docs: https://github.com/spf13/cobra/blob/main/site/content/user_guide.md
- pflag: https://github.com/spf13/pflag
- huh: https://github.com/charmbracelet/huh
- caarlos0/env: https://github.com/caarlos0/env
- signal.NotifyContext: https://pkg.go.dev/os/signal#NotifyContext
