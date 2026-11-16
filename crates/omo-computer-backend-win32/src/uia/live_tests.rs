//! Live legs on the Windows runner (`--include-ignored`): the real client on the `uia` thread
//! reads a WinForms window the test opens, with a text box and a password box.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};

use omo_computer_core::ax::{NodeRead, Slice};

use super::cache::{cache_request, Batching};
use super::reader::UiaReader;
use super::source::UiaSource;
use super::thread::UiaThread;

const FORM: &str = r#"
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'omo uia live fixture'
$text = New-Object System.Windows.Forms.TextBox
$text.Name = 'name'; $text.Text = 'hello'; $text.Top = 10
$password = New-Object System.Windows.Forms.TextBox
$password.Name = 'password'; $password.Text = 'hunter2'; $password.Top = 40; $password.UseSystemPasswordChar = $true
$form.Controls.Add($text); $form.Controls.Add($password)
$form.Add_Shown({ [Console]::Out.WriteLine([int64]$form.Handle); [Console]::Out.Flush() })
[System.Windows.Forms.Application]::Run($form)
"#;

struct Fixture {
    child: Child,
    hwnd: isize,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn open_fixture() -> Fixture {
    let mut child = Command::new("powershell")
        .args(["-NoProfile", "-Command", FORM])
        .stdout(Stdio::piped())
        .spawn()
        .expect("powershell starts");
    let mut line = String::new();
    BufReader::new(child.stdout.take().expect("stdout"))
        .read_line(&mut line)
        .expect("the form prints its handle");
    let hwnd = line.trim().parse().expect("a window handle");
    Fixture { child, hwnd }
}

fn edits(reader: &mut UiaReader<UiaThread>, node: &NodeRead, depth: u32, out: &mut Vec<NodeRead>) {
    if node.role == "Edit" {
        out.push(node.clone());
    }
    if depth == 0 {
        return;
    }
    let Some(handle) = node.handle else { return };
    if let Slice::Read(children) = reader.read_children(handle, 0, 250) {
        for child in &children {
            edits(reader, child, depth - 1, out);
        }
    }
}

#[test]
#[ignore = "live: needs an interactive Windows desktop"]
fn live_winforms_text_box_is_read_and_the_password_box_withheld() {
    let fixture = open_fixture();
    let mut reader = UiaReader::new(UiaThread::start().expect("the uia thread creates its client"));
    let root = reader.root_of(&fixture.hwnd.to_string()).expect("the form's root");
    assert_eq!(root.node.role, "Window");
    let description = {
        let mut source = UiaThread::start().expect("a second client for the description read");
        let root = source.root(fixture.hwnd).expect("root");
        source.provider_description(&root)
    };
    assert_eq!(cache_request(&description).batching, Batching::Batch, "{description}");
    let mut found = Vec::new();
    edits(&mut reader, &root.node, 4, &mut found);
    let text = found.iter().find(|n| !n.secure).expect("the text box");
    assert_eq!(text.value.as_deref(), Some("hello"));
    let password = found.iter().find(|n| n.secure).expect("the password box reads secure");
    assert_eq!(password.value, None, "the password never leaves the reader");
}
