//! A fake KWin on its own private `dbus-daemon`: `org.kde.KWin` serves
//! `org.kde.kwin.Scripting` at `/Scripting` and one `org.kde.kwin.Script` per
//! loaded script, at the object path KWin 6 (`/Scripting/Script{id}`) or
//! KWin 5 (`/{id}`) uses, or at neither. `run` answers the way the real
//! script does, with one `callDBus` to the service and path the script text
//! names, carrying the scripted reply (or nothing, for a script that never
//! answers).

use std::future::Future;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError};

use tokio::runtime::Runtime;
use zbus::object_server::ObjectServer;
use zbus::{fdo, interface};

#[derive(Debug, Clone)]
pub struct Call {
    pub method: String,
    pub plugin: String,
    pub path: PathBuf,
    pub script: Option<String>,
}

#[derive(Default)]
struct State {
    calls: Vec<Call>,
    scripts: Vec<(String, String)>,
}

type Shared = Arc<Mutex<State>>;

/// Where the fake KWin serves a loaded script's `org.kde.kwin.Script`.
#[derive(Debug, Clone, Copy)]
enum ScriptAt {
    /// `/Scripting/Script{id}`, as KWin 6 registers it.
    Kwin6,
    /// `/{id}`, as KWin 5 registers it.
    Kwin5,
    /// Nowhere: `loadScript` succeeds but no object answers `run`.
    Nowhere,
}

fn state(shared: &Shared) -> std::sync::MutexGuard<'_, State> {
    shared.lock().unwrap_or_else(PoisonError::into_inner)
}

struct Scripting {
    shared: Shared,
    reply: Option<&'static str>,
    /// Answers from this connection instead of KWin's own, when set.
    impostor: Option<zbus::Connection>,
    at: ScriptAt,
}

#[interface(name = "org.kde.kwin.Scripting")]
impl Scripting {
    #[zbus(name = "loadScript")]
    async fn load_script(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        path: String,
        plugin: String,
    ) -> fdo::Result<i32> {
        let script = std::fs::read_to_string(&path).ok();
        let id = {
            let mut state = state(&self.shared);
            state.calls.push(Call {
                method: "loadScript".to_owned(),
                plugin: plugin.clone(),
                path: PathBuf::from(&path),
                script: script.clone(),
            });
            state
                .scripts
                .push((plugin.clone(), script.unwrap_or_default()));
            i32::try_from(state.scripts.len() - 1).unwrap_or(i32::MAX)
        };
        let loaded = Script {
            shared: Arc::clone(&self.shared),
            id,
            reply: self.reply,
            impostor: self.impostor.clone(),
        };
        match self.at {
            ScriptAt::Kwin6 => server.at(format!("/Scripting/Script{id}"), loaded).await?,
            ScriptAt::Kwin5 => server.at(format!("/{id}"), loaded).await?,
            ScriptAt::Nowhere => false,
        };
        Ok(id)
    }

    #[zbus(name = "unloadScript")]
    fn unload_script(&self, plugin: String) -> bool {
        state(&self.shared).calls.push(Call {
            method: "unloadScript".to_owned(),
            plugin,
            path: PathBuf::new(),
            script: None,
        });
        true
    }
}

struct Script {
    shared: Shared,
    id: i32,
    reply: Option<&'static str>,
    impostor: Option<zbus::Connection>,
}

/// The first two string literals after `callDBus(`: service and path.
fn callback_target(script: &str) -> Option<(String, String)> {
    let args = &script[script.find("callDBus(")? + "callDBus(".len()..];
    let mut literals = args.split('"').skip(1).step_by(2);
    Some((literals.next()?.to_owned(), literals.next()?.to_owned()))
}

#[interface(name = "org.kde.kwin.Script")]
impl Script {
    #[zbus(name = "run")]
    async fn run(
        &self,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: zbus::message::Header<'_>,
    ) -> fdo::Result<()> {
        let object = header
            .path()
            .map_or_else(PathBuf::new, |path| PathBuf::from(path.as_str()));
        let (plugin, text) = {
            let mut state = state(&self.shared);
            let loaded = usize::try_from(self.id)
                .ok()
                .and_then(|id| state.scripts.get(id).cloned())
                .ok_or_else(|| fdo::Error::Failed("no such script".to_owned()))?;
            state.calls.push(Call {
                method: "run".to_owned(),
                plugin: loaded.0.clone(),
                path: object,
                script: None,
            });
            loaded
        };
        let Some(reply) = self.reply else {
            return Ok(());
        };
        let (service, path) = callback_target(&text)
            .ok_or_else(|| fdo::Error::Failed(format!("script {plugin} names no callback")))?;
        self.impostor
            .as_ref()
            .unwrap_or(connection)
            .call_method(
                Some(service.as_str()),
                path.as_str(),
                Some("dev.omo.SenpiDesktop.KwinGeometry"),
                "Windows",
                &(reply,),
            )
            .await?;
        Ok(())
    }
}

pub struct FakeKwin {
    daemon: Child,
    address: String,
    _kwin: Option<zbus::Connection>,
    _runtime: Runtime,
    shared: Shared,
}

impl FakeKwin {
    /// A bus where no `org.kde.KWin` runs.
    pub fn bus_only() -> Self {
        Self::start(None, false, ScriptAt::Kwin6)
    }

    /// KWin 6 whose script answers `reply`.
    pub fn serve(reply: &'static str) -> Self {
        Self::start(Some(Some(reply)), false, ScriptAt::Kwin6)
    }

    /// KWin 5, which serves a loaded script at `/{id}`, answering `reply`.
    pub fn serve_kwin5(reply: &'static str) -> Self {
        Self::start(Some(Some(reply)), false, ScriptAt::Kwin5)
    }

    /// KWin that loads a script but serves it at no object path `run` can reach.
    pub fn unrunnable(reply: &'static str) -> Self {
        Self::start(Some(Some(reply)), false, ScriptAt::Nowhere)
    }

    /// KWin whose script's answer arrives from another bus connection.
    pub fn impostor(reply: &'static str) -> Self {
        Self::start(Some(Some(reply)), true, ScriptAt::Kwin6)
    }

    /// KWin whose script never calls back.
    pub fn silent() -> Self {
        Self::start(Some(None), false, ScriptAt::Kwin6)
    }

    fn start(kwin: Option<Option<&'static str>>, impostor: bool, at: ScriptAt) -> Self {
        let dir = tempfile::Builder::new()
            .prefix("senpi-kwin-bus-")
            .tempdir()
            .expect("bus dir");
        let config = dir.path().join("bus.conf");
        std::fs::write(
            &config,
            bus_config(&dir.path().join("bus").display().to_string()),
        )
        .expect("bus config");
        // `$!` is the daemon itself; closing our stdin stops it and removes its dir.
        let script = "dbus-daemon --config-file=\"$1\" --nofork --print-address=1 & pid=$!; \
                      exec 1>&-; read _; kill $pid; rm -rf \"$2\"";
        let mut daemon = Command::new("sh")
            .args(["-c", script, "sh"])
            .arg(&config)
            .arg(dir.keep())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn dbus-daemon wrapper");
        let mut address = String::new();
        BufReader::new(daemon.stdout.take().expect("daemon stdout"))
            .read_line(&mut address)
            .expect("read bus address");
        let address = address.trim().to_owned();
        assert!(
            address.starts_with("unix:"),
            "dbus-daemon did not start: {address:?}"
        );
        let shared = Shared::default();
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .expect("fake kwin runtime");
        let impostor = impostor.then(|| {
            runtime
                .block_on(async {
                    zbus::connection::Builder::address(address.as_str())?
                        .build()
                        .await
                })
                .expect("impostor connection")
        });
        let kwin = kwin.map(|reply| {
            let scripting = Scripting {
                shared: Arc::clone(&shared),
                reply,
                impostor: impostor.clone(),
                at,
            };
            runtime
                .block_on(async {
                    zbus::connection::Builder::address(address.as_str())?
                        .name("org.kde.KWin")?
                        .serve_at("/Scripting", scripting)?
                        .build()
                        .await
                })
                .expect("fake kwin connection")
        });
        Self {
            daemon,
            address,
            _kwin: kwin,
            _runtime: runtime,
            shared,
        }
    }

    pub fn connect(&self) -> impl Future<Output = zbus::Result<zbus::Connection>> {
        let address = self.address.clone();
        async move {
            zbus::connection::Builder::address(address.as_str())?
                .build()
                .await
        }
    }

    pub fn calls(&self) -> Vec<Call> {
        state(&self.shared).calls.clone()
    }
}

impl Drop for FakeKwin {
    fn drop(&mut self) {
        drop(self.daemon.stdin.take());
        let _ = self.daemon.wait();
    }
}

fn bus_config(socket: &str) -> String {
    format!(
        r#"<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:path={socket}</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
"#
    )
}
