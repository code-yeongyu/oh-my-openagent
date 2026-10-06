//! Command-line parsing: the engine's flags and the mode they select.

use std::time::Duration;

use clap::{ArgGroup, Parser};

use crate::daemon;

#[derive(Debug, Parser)]
#[command(
    name = "senpi-desktop-engine",
    version,
    about = "Senpi desktop engine (JSON-RPC 2.0 over NDJSON)"
)]
#[command(group(ArgGroup::new("mode").args(["stdio", "serve", "oneshot", "mcp", "resume", "selftest", "schema"])))]
pub struct Cli {
    /// Serve on stdin/stdout (the default).
    #[arg(long)]
    stdio: bool,
    /// Serve on a unix socket path or `\\.\pipe\<name>`, one client at a time.
    #[arg(long, value_name = "ENDPOINT")]
    serve: Option<String>,
    /// With --serve (or a daemon --oneshot starts): exit after this long without a client.
    #[arg(long, value_name = "MS", default_value_t = 300_000)]
    idle_ms: u64,
    /// Forward one request line to the --serve daemon (bunshin sidecar contract).
    #[arg(long)]
    oneshot: bool,
    /// Serve MCP (tools) on stdio over the --serve daemon, starting it when needed.
    #[arg(long)]
    mcp: bool,
    /// Lift a stop latched in the daemon (the desktop user's reset).
    #[arg(long)]
    resume: bool,
    /// Daemon endpoint for --oneshot / --mcp / --resume (default: the per-user socket).
    #[arg(long, value_name = "ENDPOINT")]
    endpoint: Option<String>,
    #[command(flatten)]
    daemon: DaemonArgs,
    /// Drive a built-in fake session and print `engine: selftest ok`.
    #[arg(long)]
    selftest: bool,
    /// Print the engine protocol JSON Schema.
    #[arg(long)]
    schema: bool,
}

/// The daemon session's options (`--serve`, and `--oneshot` passes them on
/// when it starts the daemon).
#[derive(Debug, clap::Args)]
struct DaemonArgs {
    #[arg(long, value_name = "PATH")]
    audit_path: Option<std::path::PathBuf>,
    #[arg(long, value_name = "DIR")]
    artifact_dir: Option<std::path::PathBuf>,
    #[arg(long)]
    max_width: Option<u32>,
    #[arg(long)]
    max_height: Option<u32>,
    #[arg(long)]
    max_bytes: Option<u64>,
    #[arg(long)]
    display: Option<String>,
    #[arg(long, value_name = "CHORD")]
    stop_chord: Option<String>,
    #[arg(long)]
    allow_host_relay_only_stop: bool,
}

impl DaemonArgs {
    fn options(&self) -> daemon::DaemonOptions {
        daemon::DaemonOptions {
            audit_path: self.audit_path.clone(),
            artifact_dir: self.artifact_dir.clone(),
            max_width: self.max_width,
            max_height: self.max_height,
            max_bytes: self.max_bytes,
            display: self.display.clone(),
            stop_chord: self.stop_chord.clone(),
            allow_host_relay_only_stop: self.allow_host_relay_only_stop,
        }
    }

    /// The same options as `--serve` flags, for an auto-started daemon.
    fn serve_args(&self) -> Vec<String> {
        let mut args = Vec::new();
        let mut push = |flag: &str, value: Option<String>| {
            if let Some(value) = value {
                args.extend([flag.to_owned(), value]);
            }
        };
        push(
            "--audit-path",
            self.audit_path.as_ref().map(|path| path.display().to_string()),
        );
        push(
            "--artifact-dir",
            self.artifact_dir.as_ref().map(|path| path.display().to_string()),
        );
        push("--max-width", self.max_width.map(|value| value.to_string()));
        push("--max-height", self.max_height.map(|value| value.to_string()));
        push("--max-bytes", self.max_bytes.map(|value| value.to_string()));
        push("--display", self.display.clone());
        push("--stop-chord", self.stop_chord.clone());
        if self.allow_host_relay_only_stop {
            args.push("--allow-host-relay-only-stop".to_owned());
        }
        args
    }
}

pub enum Mode {
    Stdio,
    Serve {
        endpoint: String,
        idle: Duration,
        daemon: daemon::DaemonOptions,
    },
    Oneshot {
        endpoint: Option<String>,
        serve_args: Vec<String>,
    },
    Mcp {
        endpoint: Option<String>,
        serve_args: Vec<String>,
        allow_host_relay_only_stop: bool,
    },
    Resume {
        endpoint: Option<String>,
    },
    Selftest,
    Schema,
}

impl Cli {
    pub fn mode(self) -> Mode {
        if let Some(endpoint) = self.serve {
            Mode::Serve {
                endpoint,
                idle: Duration::from_millis(self.idle_ms),
                daemon: self.daemon.options(),
            }
        } else if self.oneshot {
            Mode::Oneshot {
                endpoint: self.endpoint,
                serve_args: [
                    vec!["--idle-ms".to_owned(), self.idle_ms.to_string()],
                    self.daemon.serve_args(),
                ]
                .concat(),
            }
        } else if self.mcp {
            Mode::Mcp {
                endpoint: self.endpoint,
                serve_args: [
                    vec!["--idle-ms".to_owned(), self.idle_ms.to_string()],
                    self.daemon.serve_args(),
                ]
                .concat(),
                allow_host_relay_only_stop: self.daemon.allow_host_relay_only_stop,
            }
        } else if self.resume {
            Mode::Resume {
                endpoint: self.endpoint,
            }
        } else if self.selftest {
            Mode::Selftest
        } else if self.schema {
            Mode::Schema
        } else {
            Mode::Stdio
        }
    }
}
