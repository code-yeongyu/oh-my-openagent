//! The closed refusal set of every stage after gate 2. Each member is one `(code, reason)`
//! row of the error table; the session hands the verdicts of the stages it owns to the gate.

verdicts! {
    /// Gate 3: the lock (a positive probe only; `unknown` never refuses).
    LockRefusal [1] {
        ScreenLocked => ScreenLocked(ScreenLocked),
    }
}

verdicts! {
    /// Gate 4: the effective target and the protected-target table.
    TargetRefusal [6] {
        SelfTarget => ProtectedProcess(SelfTarget),
        /// `apps.quit` on a protected process or a self-set member.
        ProtectedProcess => ProtectedProcess,
        ProtectedSurface => InvalidTarget(ProtectedSurface),
        /// A keyboard verb whose focused window cannot be read.
        FocusUnknown => BackgroundUnavailable(FocusUnknown),
        /// A pointer verb whose window under the point cannot be read.
        TargetUnknown => BackgroundUnavailable(TargetUnknown),
        /// A point of a multi-point request was refused; the refusal names it.
        DragDestination => InvalidTarget(DragDestination),
    }
}

verdicts! {
    /// Gate 5: the OS input permission (never prompts here).
    PermissionRefusal [1] {
        Denied => PermissionDenied,
    }
}

verdicts! {
    /// Gate 6: consent and per-app scope.
    ConsentRefusal [6] {
        AppScope => ControlRequired(AppScope),
        DeniedApp => ControlRequired(DeniedApp),
        DeniedThisTurn => ControlRequired(DeniedThisTurn),
        UserStopped => ControlRequired(UserStopped),
        IdentityChanged => ControlRequired(IdentityChanged),
        ConsentOff => ControlRequired(ConsentOff),
    }
}

verdicts! {
    /// Gate 7: route admission for the session state and the toolkit class.
    RouteRefusal [9] {
        SessionDeactivated => SessionInactive(SessionDeactivated),
        DisplayAsleep => ControlRequired(DisplayAsleep),
        Toolkit => BackgroundUnavailable(Toolkit),
        CanvasGl => BackgroundUnavailable(CanvasGl),
        ChromiumElectron => BackgroundUnavailable(ChromiumElectron),
        PointerHw => BackgroundUnavailable(PointerHw),
        QtCoreKeyboard => BackgroundUnavailable(QtCoreKeyboard),
        KeyRouteUnproven => BackgroundUnavailable(KeyRouteUnproven),
        Unresolvable => InvalidKey(Unresolvable),
    }
}

verdicts! {
    /// Gate 8: the foreground grant, the presence surface, the locks and reservations.
    LeaseRefusal [12] {
        Grant => ControlRequired,
        HeadlessHost => ControlRequired(HeadlessHost),
        LeaseMissing => ControlRequired(LeaseMissing),
        SpawnInsideSession => ControlRequired(SpawnInsideSession),
        Foreground => ControlRequired(Foreground),
        NoPresenceSurface => ControlRequired(NoPresenceSurface),
        WaylandNoEscape => ControlRequired(WaylandNoEscape),
        InputBusy => InputBusy,
        Window => InputBusy(Window),
        AppLeased => InputBusy(AppLeased),
        TargetBusy => InputBusy(TargetBusy),
        Budget => InputBusy(Budget),
    }
}

verdicts! {
    /// Gate 9: the consequential gate (the dangerous chord is decided here from the table).
    ConsequentialRefusal [3] {
        DangerousChord => InvalidKey(DangerousChord),
        SendOnEnter => ConsequentialAction(SendOnEnter),
        UrlPolicy => ControlRequired(UrlPolicy),
    }
}

verdicts! {
    /// Gate 10: frame and ref admission.
    FrameRefusal [9] {
        FrameRequired => InvalidCoordinateFrame(FrameRequired),
        WrongTarget => InvalidCoordinateFrame(WrongTarget),
        NoCapture => InvalidCoordinateFrame(NoCapture),
        Superseded => InvalidCoordinateFrame(Superseded),
        Consumed => InvalidCoordinateFrame(Consumed),
        IdentityChanged => WindowNotFound(IdentityChanged),
        NeedsObserve => ControlRequired(NeedsObserve),
        StaleRef => StaleRef,
        AmbiguousTarget => AmbiguousTarget,
    }
}

verdicts! {
    /// Gate 11: the takeover gate (physical input in the target within 1,500 ms).
    TakeoverRefusal [1] {
        UserActiveInTarget => BackgroundUnavailable(UserActiveInTarget),
    }
}
