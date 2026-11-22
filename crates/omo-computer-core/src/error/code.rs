//! The two code sets of the error contract: the closed 33-code engine table (the 31 codes
//! the v1 wire numbers `-32000 - ordinal`, then `SessionInactive` and
//! `ConsequentialAction` appended) and the 56 `COMPUTER_*` members the tool and the
//! adapter show.

/// First number of the engine code range: ordinal `n` is `-32000 - n`.
pub const ENGINE_CODE_BASE: i64 = -32_000;

closed_names! {
    /// The closed engine code table. Append-only: a new code takes the next ordinal.
    EngineCode [33] {
        PermissionDenied = "PermissionDenied",
        CaptureFailed = "CaptureFailed",
        InputFailed = "InputFailed",
        BackgroundUnavailable = "BackgroundUnavailable",
        WindowNotFound = "WindowNotFound",
        InvalidTarget = "InvalidTarget",
        InvalidKey = "InvalidKey",
        InvalidCoordinateFrame = "InvalidCoordinateFrame",
        StaleRef = "StaleRef",
        AxUnsupported = "AxUnsupported",
        AxFailed = "AxFailed",
        Timeout = "Timeout",
        Closed = "Closed",
        Internal = "Internal",
        StopPathUnavailable = "StopPathUnavailable",
        Suspended = "Suspended",
        ScreenLocked = "ScreenLocked",
        Cancelled = "Cancelled",
        CursorRestoreFailed = "CursorRestoreFailed",
        FocusRestoreFailed = "FocusRestoreFailed",
        TransactionFailed = "TransactionFailed",
        InputBusy = "InputBusy",
        ControlRequired = "ControlRequired",
        CaptureUnavailable = "CaptureUnavailable",
        UserIntervened = "UserIntervened",
        AxUnconfirmed = "AxUnconfirmed",
        SpaceUnsupported = "SpaceUnsupported",
        SpaceMoveDenied = "SpaceMoveDenied",
        AmbiguousTarget = "AmbiguousTarget",
        CaptureConsentRequired = "CaptureConsentRequired",
        ProtectedProcess = "ProtectedProcess",
        SessionInactive = "SessionInactive",
        ConsequentialAction = "ConsequentialAction",
    }
}

impl EngineCode {
    /// The numeric JSON-RPC error code: `-32000 - ordinal`.
    #[must_use]
    pub const fn number(self) -> i64 {
        ENGINE_CODE_BASE - self as i64
    }

    /// The code numbered `number`, if it is in the closed table.
    #[must_use]
    pub fn from_number(number: i64) -> Option<Self> {
        Self::ALL.into_iter().find(|code| code.number() == number)
    }
}

closed_names! {
    /// The model-facing failure codes.
    ComputerCode [56] {
        Suspended = "COMPUTER_SUSPENDED",
        SupervisorNotLive = "COMPUTER_SUPERVISOR_NOT_LIVE",
        PermissionRequired = "COMPUTER_PERMISSION_REQUIRED",
        PermissionDenied = "COMPUTER_PERMISSION_DENIED",
        DisplayStale = "COMPUTER_DISPLAY_STALE",
        CoordInvalid = "COMPUTER_COORD_INVALID",
        StaleRef = "COMPUTER_STALE_REF",
        AmbiguousTarget = "COMPUTER_AMBIGUOUS_TARGET",
        ScreenLocked = "COMPUTER_SCREEN_LOCKED",
        ScreenshotFailed = "COMPUTER_SCREENSHOT_FAILED",
        CaptureUnavailable = "COMPUTER_CAPTURE_UNAVAILABLE",
        CaptureConsentRequired = "COMPUTER_CAPTURE_CONSENT_REQUIRED",
        CursorRestoreFailed = "COMPUTER_CURSOR_RESTORE_FAILED",
        FocusRestoreFailed = "COMPUTER_FOCUS_RESTORE_FAILED",
        BackgroundUnavailable = "COMPUTER_BACKGROUND_UNAVAILABLE",
        ControlRequired = "COMPUTER_CONTROL_REQUIRED",
        InputBusy = "COMPUTER_INPUT_BUSY",
        Busy = "COMPUTER_BUSY",
        UserIntervened = "COMPUTER_USER_INTERVENED",
        AxUnconfirmed = "COMPUTER_AX_UNCONFIRMED",
        InputFailed = "COMPUTER_INPUT_FAILED",
        InvalidKey = "COMPUTER_INVALID_KEY",
        InvalidArguments = "COMPUTER_INVALID_ARGUMENTS",
        SpaceUnsupported = "COMPUTER_SPACE_UNSUPPORTED",
        SpaceMoveDenied = "COMPUTER_SPACE_MOVE_DENIED",
        Cancelled = "COMPUTER_CANCELLED",
        ProtectedTarget = "COMPUTER_PROTECTED_TARGET",
        SelfTarget = "COMPUTER_SELF_TARGET",
        WindowImmovable = "COMPUTER_WINDOW_IMMOVABLE",
        WindowFrameUnavailable = "COMPUTER_WINDOW_FRAME_UNAVAILABLE",
        PresenceUnavailable = "COMPUTER_PRESENCE_UNAVAILABLE",
        HandCrashed = "COMPUTER_HAND_CRASHED",
        HandOffline = "COMPUTER_HAND_OFFLINE",
        LinkDegraded = "COMPUTER_LINK_DEGRADED",
        TransportLost = "COMPUTER_TRANSPORT_LOST",
        RemoteCommandsDisabled = "COMPUTER_REMOTE_COMMANDS_DISABLED",
        EntitlementRequired = "COMPUTER_ENTITLEMENT_REQUIRED",
        TransactionFailed = "COMPUTER_TRANSACTION_FAILED",
        AxUnavailable = "COMPUTER_AX_UNAVAILABLE",
        InvalidTarget = "COMPUTER_INVALID_TARGET",
        WindowNotFound = "COMPUTER_WINDOW_NOT_FOUND",
        ProtocolMismatch = "COMPUTER_PROTOCOL_MISMATCH",
        FeatureUnavailable = "COMPUTER_FEATURE_UNAVAILABLE",
        HandOutdated = "COMPUTER_HAND_OUTDATED",
        Replayed = "COMPUTER_REPLAYED",
        UnsupportedAction = "COMPUTER_UNSUPPORTED_ACTION",
        SafetyCheckDeclined = "COMPUTER_SAFETY_CHECK_DECLINED",
        Disabled = "COMPUTER_DISABLED",
        SecureFocus = "COMPUTER_SECURE_FOCUS",
        AuditUnavailable = "COMPUTER_AUDIT_UNAVAILABLE",
        LaunchContextRequired = "COMPUTER_LAUNCH_CONTEXT_REQUIRED",
        RunLimit = "COMPUTER_RUN_LIMIT",
        Unavailable = "COMPUTER_UNAVAILABLE",
        Internal = "COMPUTER_INTERNAL",
        SessionInactive = "COMPUTER_SESSION_INACTIVE",
        ConsequentialAction = "COMPUTER_CONSEQUENTIAL_ACTION",
    }
}
