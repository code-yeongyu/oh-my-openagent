//! Ignored real UIA probe: a WinForms `MenuStrip` has no HMENU, so listing and
//! selection go through the UI Automation route. A record file proves which
//! commands ran; a later sentinel command proves refusals dispatched nothing.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use senpi_desktop_core::backend::{Backend, DeliveryMode};
use senpi_desktop_core::types::{DesktopWindow, DisplaySelector};

use crate::Win32Backend;

const DEADLINE: Duration = Duration::from_secs(60);
const FORM: &str = r#"
param($title, $record)
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object Windows.Forms.Form
$form.Text = $title
$strip = New-Object Windows.Forms.MenuStrip
function Item($label, $enabled) {
    $item = New-Object Windows.Forms.ToolStripMenuItem($label)
    $item.Enabled = $enabled
    $item.add_Click({ param($sender) Add-Content -Path $record -Value $sender.Text })
    [void]$strip.Items.Add($item)
}
Item 'Run' $true
Item 'Locked' $false
Item 'Sentinel' $true
$form.MainMenuStrip = $strip
$form.Controls.Add($strip)
[Windows.Forms.Application]::Run($form)
"#;

struct Form {
    child: Child,
    script: PathBuf,
    record: PathBuf,
}

impl Drop for Form {
    fn drop(&mut self) {
        if let Err(error) = self.child.kill().and_then(|()| self.child.wait().map(drop)) {
            eprintln!("form cleanup failed: {error}");
        }
        drop(std::fs::remove_file(&self.record));
        drop(std::fs::remove_file(&self.script));
    }
}

fn open(title: &str) -> Form {
    let dir = std::env::temp_dir();
    let script = dir.join(format!("{title}.ps1"));
    let record = dir.join(format!("{title}.record"));
    std::fs::write(&script, FORM).unwrap();
    std::fs::write(&record, "").unwrap();
    let child = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-File"])
        .arg(&script)
        .arg(title)
        .arg(&record)
        .spawn()
        .unwrap();
    Form {
        child,
        script,
        record,
    }
}

fn until<T>(what: &str, mut probe: impl FnMut() -> Option<T>) -> T {
    let started = Instant::now();
    loop {
        if let Some(found) = probe() {
            return found;
        }
        assert!(started.elapsed() < DEADLINE, "{what} never happened");
        std::thread::yield_now();
    }
}

fn recorded(form: &Form) -> Vec<String> {
    std::fs::read_to_string(&form.record)
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect()
}

fn path(labels: &[&str]) -> Vec<String> {
    labels.iter().map(|label| (*label).into()).collect()
}

#[test]
#[ignore = "live: needs an interactive Windows desktop with Windows PowerShell"]
fn uia_menu_strip_listing_selection_and_refusals() {
    let title = format!("senpi-uia-menu-{}", std::process::id());
    let form = open(&title);
    let mut backend = Win32Backend::new(DisplaySelector::All).unwrap();
    let window: DesktopWindow = until("the form window", || {
        backend.windows().ok()?.into_iter().find(|window| window.title == title)
    });
    let items = backend.menu_items(&window, &[]).unwrap();
    let titles: Vec<&str> = items.iter().map(|item| item.title.as_str()).collect();
    assert_eq!(titles, ["Run", "Locked", "Sentinel"]);
    assert!(items[0].enabled && !items[1].enabled);

    let select = |backend: &mut Win32Backend, labels: &[&str]| {
        backend.menu_select(&window, &path(labels), DeliveryMode::Background, &|| Ok(()))
    };
    select(&mut backend, &["run"]).unwrap();
    until("Run to be recorded", || (recorded(&form) == ["Run"]).then_some(()));
    assert!(select(&mut backend, &["Locked"]).is_err());
    assert!(select(&mut backend, &["Missing"]).is_err());
    select(&mut backend, &["Sentinel"]).unwrap();
    until("the sentinel", || (recorded(&form).len() >= 2).then_some(()));
    assert_eq!(recorded(&form), ["Run", "Sentinel"], "a refused path ran a command");
    println!("uia_listing=pass uia_select=pass uia_refusals_no_dispatch=pass");
}
