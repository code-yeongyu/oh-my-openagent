//! RuntimeId reads and the re-identification search (reviews of #13837: M2 at 527204b381, the
//! MEDIUM at 44cdbb2103): an element is searched for in ONE top-level window as it is now, matched
//! by a `RuntimeId` property condition, never across the desktop.

use windows::Win32::Foundation::HWND;
use windows::Win32::System::Ole::{
    SafeArrayCreateVector, SafeArrayDestroy, SafeArrayGetElement, SafeArrayGetLBound, SafeArrayGetUBound,
    SafeArrayPutElement,
};
use windows::Win32::System::Variant::{VariantClear, VARENUM, VARIANT, VT_ARRAY, VT_I4};
use windows::Win32::UI::Accessibility::{
    IUIAutomationCondition, IUIAutomationElement, TreeScope_Subtree, UIA_RuntimeIdPropertyId,
};

use super::{read, top_level_of, ComUia};
use crate::uia::cache::CacheRequest;
use crate::uia::element::UiaElement;

/// The `RuntimeId` of `element`, read from its SAFEARRAY of `i32`.
pub(super) fn runtime_id(element: &IUIAutomationElement) -> Vec<i32> {
    // SAFETY: GetRuntimeId returns an owned one-dimensional SAFEARRAY of VT_I4, destroyed below.
    unsafe {
        let Ok(array) = element.GetRuntimeId() else {
            return Vec::new();
        };
        let (Ok(low), Ok(high)) = (SafeArrayGetLBound(array, 1), SafeArrayGetUBound(array, 1)) else {
            let _ = SafeArrayDestroy(array);
            return Vec::new();
        };
        let mut id = Vec::new();
        for index in low..=high {
            let mut part = 0i32;
            if SafeArrayGetElement(array, &index, (&raw mut part).cast()).is_ok() {
                id.push(part);
            }
        }
        let _ = SafeArrayDestroy(array);
        id
    }
}

impl ComUia {
    /// `RuntimeId == wanted` as a UIA property condition (a `VT_ARRAY | VT_I4` VARIANT).
    fn runtime_id_condition(&self, wanted: &[i32]) -> Option<IUIAutomationCondition> {
        let count = u32::try_from(wanted.len()).ok()?;
        // SAFETY: a VT_I4 vector of `count` elements written at indices below `count`; the VARIANT
        // owns it from then on and VariantClear frees it once, after the condition copied it.
        unsafe {
            let array = SafeArrayCreateVector(VT_I4, 0, count);
            if array.is_null() {
                return None;
            }
            for (index, part) in (0i32..).zip(wanted) {
                if SafeArrayPutElement(array, &index, std::ptr::from_ref(part).cast()).is_err() {
                    let _ = SafeArrayDestroy(array);
                    return None;
                }
            }
            let mut value = VARIANT::default();
            let inner = &mut *value.Anonymous.Anonymous;
            inner.vt = VARENUM(VT_ARRAY.0 | VT_I4.0);
            inner.Anonymous.parray = array;
            let condition = self.automation.CreatePropertyCondition(UIA_RuntimeIdPropertyId, &value).ok();
            let _ = VariantClear(&mut value);
            condition
        }
    }

    /// The top-level window to search for `wanted`: `hwnd` when named, else the window the kept
    /// element was last seen in (a windowless one's nearest windowed ancestor); 0 when unknown.
    fn search_window(&self, hwnd: isize, wanted: &[i32]) -> isize {
        if hwnd != 0 {
            return hwnd;
        }
        let Some(seen) = self.kept.get(wanted) else {
            return 0;
        };
        match top_level_of(read(seen).hwnd) {
            0 => self.window_of_windowless(seen),
            window => window,
        }
    }

    /// Every element in top-level window `hwnd` (0: the window it was last seen in) whose
    /// `RuntimeId` is `wanted`, read fresh and kept for the next refresh. No window, no search: a
    /// desktop-wide subtree search would stall every later call on the one `uia` thread.
    pub fn find_runtime_id(&mut self, hwnd: isize, wanted: &[i32], request: &CacheRequest) -> Vec<UiaElement> {
        let window = self.search_window(hwnd, wanted);
        if window == 0 {
            return Vec::new();
        }
        let (Some(cache), Some(condition)) = (self.cache(request, false), self.runtime_id_condition(wanted)) else {
            return Vec::new();
        };
        // SAFETY: a window handle UIA validates, a condition and a cache request owned by this
        // thread.
        let found = unsafe {
            self.automation
                .ElementFromHandle(HWND(window as *mut _))
                .and_then(|scope| scope.FindAllBuildCache(TreeScope_Subtree, &condition, &cache))
        };
        let Ok(found) = found else {
            return Vec::new();
        };
        // SAFETY: indices below Length().
        let length = unsafe { found.Length() }.unwrap_or(0);
        (0..length)
            .filter_map(|index| unsafe { found.GetElement(index) }.ok())
            .filter(|element| runtime_id(element) == wanted)
            .map(|element| self.keep(element))
            .collect()
    }
}
