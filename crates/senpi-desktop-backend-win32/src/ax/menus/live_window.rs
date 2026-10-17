//! Real HMENU fixture with a message-loop thread and command sentinel.

use senpi_desktop_core::types::DesktopWindow;
use std::cell::RefCell;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::JoinHandle;
use std::time::Duration;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

thread_local! {
    static COMMANDS: RefCell<Option<Sender<u32>>> = const { RefCell::new(None) };
}

const SENTINEL: u32 = 60000;
const DEADLINE: Duration = Duration::from_secs(10);

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

unsafe extern "system" fn wndproc(hwnd: HWND, message: u32, wparam: usize, lparam: isize) -> isize {
    match message {
        WM_COMMAND => {
            COMMANDS.with(|slot| {
                if let Some(sender) = slot.borrow().as_ref() {
                    let _ = sender.send((wparam & 0xffff) as u32);
                }
            });
            0
        }
        WM_CLOSE => {
            // SAFETY: Win32 supplied this window to its own registered callback.
            unsafe { DestroyWindow(hwnd) };
            0
        }
        WM_DESTROY => {
            // SAFETY: quits only this fixture thread's message loop.
            unsafe { PostQuitMessage(0) };
            0
        }
        _ => {
            // SAFETY: forwards the unmodified Win32 callback arguments.
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }
    }
}

fn append(menu: HMENU, flags: u32, id: usize, title: &str) {
    let label = wide(title);
    // SAFETY: label is NUL terminated and lives through this copying API.
    assert_ne!(unsafe { AppendMenuW(menu, flags, id, label.as_ptr()) }, 0);
}

fn menu() -> HMENU {
    // SAFETY: these constructors take no arguments and return opaque handles.
    let bar = unsafe { CreateMenu() };
    // SAFETY: same constructor contract for the first submenu.
    let file = unsafe { CreatePopupMenu() };
    // SAFETY: same constructor contract for the nested submenu.
    let recent = unsafe { CreatePopupMenu() };
    // SAFETY: same constructor contract for the disabled-command submenu.
    let edit = unsafe { CreatePopupMenu() };
    assert!(!bar.is_null() && !file.is_null() && !recent.is_null() && !edit.is_null());
    append(file, MF_STRING, 101, "&Open...\tCtrl+O");
    append(file, MF_STRING, 102, "&Save");
    append(recent, MF_STRING, 103, "a.txt");
    append(file, MF_POPUP, recent.addr(), "&Recent");
    append(file, MF_SEPARATOR, 0, "");
    append(file, MF_STRING, 104, "Duplicate...");
    append(file, MF_STRING, 105, "Duplicate...");
    append(edit, MF_STRING | MF_GRAYED, 106, "&Undo");
    append(bar, MF_POPUP, file.addr(), "&File");
    append(bar, MF_POPUP, edit.addr(), "&Edit");
    bar
}

pub(super) struct Window {
    hwnd: usize,
    commands: Receiver<u32>,
    thread: Option<JoinHandle<()>>,
}

impl Window {
    pub fn new() -> Self {
        let (ready_tx, ready) = mpsc::channel();
        let (commands_tx, commands) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            COMMANDS.with(|slot| *slot.borrow_mut() = Some(commands_tx));
            let class = wide("SenpiMenuLiveFixture");
            // SAFETY: null requests the current module's existing handle.
            let instance = unsafe { GetModuleHandleW(std::ptr::null()) };
            // SAFETY: WNDCLASSW is a C structure valid when zero initialized.
            let mut wc: WNDCLASSW = unsafe { std::mem::zeroed() };
            wc.lpfnWndProc = Some(wndproc);
            wc.hInstance = instance;
            wc.lpszClassName = class.as_ptr();
            // SAFETY: class and callback live through registration and the window.
            assert_ne!(unsafe { RegisterClassW(&wc) }, 0);
            let menu = menu();
            // SAFETY: class is registered; strings are terminated, menu belongs
            // to this thread, and null creation data is accepted.
            let hwnd = unsafe {
                CreateWindowExW(
                    0,
                    class.as_ptr(),
                    class.as_ptr(),
                    WS_OVERLAPPEDWINDOW,
                    0,
                    0,
                    400,
                    300,
                    std::ptr::null_mut(),
                    menu,
                    instance,
                    std::ptr::null(),
                )
            };
            assert!(!hwnd.is_null());
            ready_tx.send(hwnd.addr()).unwrap();
            // SAFETY: MSG contains scalars and pointers valid when zero initialized.
            let mut message: MSG = unsafe { std::mem::zeroed() };
            loop {
                // SAFETY: message is a writable MSG for this thread's queue.
                let result = unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) };
                assert!(result >= 0);
                if result == 0 {
                    break;
                }
                // SAFETY: message was initialized by GetMessageW.
                unsafe { TranslateMessage(&message) };
                // SAFETY: message was initialized by GetMessageW.
                unsafe { DispatchMessageW(&message) };
            }
            // SAFETY: the window is destroyed and no instance still uses the class.
            assert_ne!(unsafe { UnregisterClassW(class.as_ptr(), instance) }, 0);
        });
        Self {
            hwnd: ready.recv_timeout(DEADLINE).unwrap(),
            commands,
            thread: Some(thread),
        }
    }

    pub fn desktop(&self) -> DesktopWindow {
        DesktopWindow {
            id: self.hwnd.to_string(),
            pid: Some(std::process::id()),
            title: "menu fixture".into(),
            app: "senpi menu test".into(),
            x: 0,
            y: 0,
            width: 400,
            height: 300,
            focused: false,
            elevated: Some(false),
            is_on_screen: None,
        }
    }

    pub fn drain(&self) -> Vec<u32> {
        let hwnd = std::ptr::without_provenance_mut(self.hwnd);
        let mut result = 0;
        // SAFETY: only scalar command data is sent to this live fixture window.
        assert_ne!(
            unsafe {
                SendMessageTimeoutW(
                    hwnd,
                    WM_COMMAND,
                    SENTINEL as usize,
                    0,
                    SMTO_ABORTIFHUNG,
                    1500,
                    &mut result,
                )
            },
            0
        );
        let mut commands = Vec::new();
        loop {
            let id = self.commands.recv_timeout(DEADLINE).unwrap();
            if id == SENTINEL {
                return commands;
            }
            commands.push(id);
        }
    }
}

impl Drop for Window {
    fn drop(&mut self) {
        // SAFETY: fixture owns this window; WM_CLOSE ends its loop after destroy.
        unsafe { PostMessageW(std::ptr::without_provenance_mut(self.hwnd), WM_CLOSE, 0, 0) };
        if let Some(thread) = self.thread.take() {
            if let Err(error) = thread.join() {
                eprintln!("menu fixture teardown failed: {error:?}");
            }
        }
    }
}
