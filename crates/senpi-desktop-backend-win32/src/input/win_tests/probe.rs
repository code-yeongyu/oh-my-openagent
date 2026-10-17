use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging as wm;

pub(super) struct ProbeWindow {
    pub(super) hwnd: HWND,
    class: Vec<u16>,
}

impl ProbeWindow {
    pub(super) fn new(class: &str) -> Self {
        Self::create(class, false)
    }

    pub(super) fn visible(class: &str) -> Self {
        Self::create(class, true)
    }

    fn create(class: &str, visible: bool) -> Self {
        let class: Vec<u16> = class.encode_utf16().chain([0]).collect();
        // SAFETY: [Category 8 - FFI boundary] null selects this executable.
        let instance = unsafe { GetModuleHandleW(std::ptr::null()) };
        let registration = wm::WNDCLASSW {
            lpfnWndProc: Some(wm::DefWindowProcW),
            hInstance: instance,
            lpszClassName: class.as_ptr(),
            ..wm::WNDCLASSW::default()
        };
        // SAFETY: [Category 8 - FFI boundary] registration and its UTF-16
        // class name remain alive for the synchronous registration.
        assert_ne!(unsafe { wm::RegisterClassW(&raw const registration) }, 0);
        let mut owner = Self {
            hwnd: std::ptr::null_mut(),
            class,
        };
        let (style, parent) = if visible {
            (
                wm::WS_OVERLAPPEDWINDOW | wm::WS_VISIBLE,
                std::ptr::null_mut(),
            )
        } else {
            (0, wm::HWND_MESSAGE)
        };
        // SAFETY: [Category 8 - FFI boundary] the registered class is owned
        // before creation, so a failed assertion also unregisters it.
        owner.hwnd = unsafe {
            wm::CreateWindowExW(
                0,
                owner.class.as_ptr(),
                owner.class.as_ptr(),
                style,
                100,
                100,
                320,
                240,
                parent,
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            )
        };
        assert!(!owner.hwnd.is_null(), "CreateWindowExW failed");
        owner
    }

    pub(super) fn id(&self) -> String {
        self.hwnd.addr().to_string()
    }

    pub(super) fn drain(&self) -> Vec<(u32, usize)> {
        let mut message = wm::MSG::default();
        let mut seen = Vec::new();
        // SAFETY: [Category 8 - FFI boundary] message is writable and this
        // thread owns the live window and its message queue.
        while unsafe { wm::PeekMessageW(&raw mut message, self.hwnd, 0, 0, wm::PM_REMOVE) } != 0 {
            seen.push((message.message, message.wParam));
        }
        seen
    }

    pub(super) fn child(&self) -> HWND {
        let button: Vec<u16> = "BUTTON".encode_utf16().chain([0]).collect();
        // SAFETY: [Category 8 - FFI boundary] BUTTON is a system class.
        // Destroying the owned parent also destroys its child windows.
        let child = unsafe {
            wm::CreateWindowExW(
                0,
                button.as_ptr(),
                button.as_ptr(),
                wm::WS_CHILD | wm::WS_VISIBLE,
                20,
                20,
                120,
                60,
                self.hwnd,
                std::ptr::null_mut(),
                GetModuleHandleW(std::ptr::null()),
                std::ptr::null(),
            )
        };
        assert!(!child.is_null(), "child creation failed");
        child
    }
}

impl Drop for ProbeWindow {
    fn drop(&mut self) {
        // SAFETY: [Category 8 - FFI boundary] the creating thread owns the
        // window and class. Destruction releases all child windows first.
        unsafe {
            if !self.hwnd.is_null() && wm::DestroyWindow(self.hwnd) == 0 {
                eprintln!(
                    "probe DestroyWindow failed: {}",
                    std::io::Error::last_os_error()
                );
            }
            if wm::UnregisterClassW(self.class.as_ptr(), GetModuleHandleW(std::ptr::null())) == 0 {
                eprintln!(
                    "probe UnregisterClassW failed: {}",
                    std::io::Error::last_os_error()
                );
            }
        }
    }
}
