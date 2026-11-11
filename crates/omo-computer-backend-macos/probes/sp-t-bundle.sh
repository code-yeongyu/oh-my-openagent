#!/bin/bash
# SP-T helper: builds the probe executable and the signed probe bundle (macOS only).
#
#   sp-t-bundle.sh spawner <out-binary>
#       the spawn helper the Bun host uses for the disclaim and plain-spawn launch paths (ad-hoc signed)
#   sp-t-bundle.sh app <app-path> <bundle-id> <display-name> <marker>
#       a minimal LSUIElement bundle whose CFBundleExecutable is `omo-computer-engine`, signed with the
#       run-local T3 identity ($CU_RUN/t3-signing). Prints `cdhash=<hex>` and `requirement=<designated requirement>`.
#
# The probe executable is a spike instrument, not engine code: it reports who it is, who is responsible for it,
# which launchd manager it runs under and the three non-prompting TCC preflights, and nothing else.
set -euo pipefail

die() { echo "sp-t-bundle: $*" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || die "missing precondition: a macOS host (uname -s is $(uname -s))"
command -v clang >/dev/null || die "missing precondition: clang (Xcode command line tools)"

workdir=$(mktemp -d "${TMPDIR:-/tmp}/sp-t-bundle.XXXXXX")
trap 'rm -rf "$workdir"' EXIT

write_source() {
	cat >"$workdir/probe.c" <<'C_SOURCE'
#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <Security/AuthSession.h>
#include <bsm/audit.h>
#include <dlfcn.h>
#include <libproc.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef SPT_MARKER
#define SPT_MARKER "unset"
#endif

extern char **environ;
typedef int (*responsible_fn)(pid_t);
typedef int (*disclaim_fn)(posix_spawnattr_t *, int);

static void put_str(FILE *f, const char *s) {
	fputc('"', f);
	for (; s && *s; s++) {
		unsigned char c = (unsigned char)*s;
		if (c == '"' || c == '\\') { fputc('\\', f); fputc(c, f); }
		else if (c < 0x20) fprintf(f, "\\u%04x", c);
		else fputc(c, f);
	}
	fputc('"', f);
}

static void pid_path(pid_t pid, char *buf) {
	buf[0] = 0;
	if (pid > 0 && proc_pidpath(pid, buf, PROC_PIDPATHINFO_MAXSIZE) <= 0) buf[0] = 0;
}

static pid_t parent_of(pid_t pid) {
	struct proc_bsdinfo info;
	if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof info) != (int)sizeof info) return -1;
	return (pid_t)info.pbi_ppid;
}

static void manager_name(char *out, size_t n) {
	out[0] = 0;
	FILE *p = popen("/bin/launchctl managername 2>&1", "r");
	if (!p) return;
	if (!fgets(out, (int)n, p)) out[0] = 0;
	pclose(p);
	size_t l = strlen(out);
	while (l && (out[l - 1] == '\n' || out[l - 1] == '\r')) out[--l] = 0;
}

static const char *arg_value(int argc, char **argv, const char *name) {
	for (int i = 0; i + 1 < argc; i++) if (strcmp(argv[i], name) == 0) return argv[i + 1];
	return "";
}

static int has_flag(int argc, char **argv, const char *name) {
	for (int i = 0; i < argc; i++) if (strcmp(argv[i], name) == 0) return 1;
	return 0;
}

static int prompt_accessibility(void) {
	const void *keys[] = { kAXTrustedCheckOptionPrompt };
	const void *values[] = { kCFBooleanTrue };
	CFDictionaryRef options = CFDictionaryCreate(NULL, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
	int trusted = AXIsProcessTrustedWithOptions(options) ? 1 : 0;
	CFRelease(options);
	return trusted;
}

/* report --result <file> [--tag <t>] [--host-pid <pid>] [--prompt ax|all] */
static int report(int argc, char **argv) {
	const char *result = arg_value(argc, argv, "--result");
	if (!*result) { fprintf(stderr, "report: --result is required\n"); return 2; }
	const char *prompt = arg_value(argc, argv, "--prompt");
	pid_t self = getpid();
	char exe[PROC_PIDPATHINFO_MAXSIZE], resp_exe[PROC_PIDPATHINFO_MAXSIZE], manager[256];
	pid_path(self, exe);
	responsible_fn responsible = (responsible_fn)dlsym(RTLD_DEFAULT, "responsibility_get_pid_responsible_for_pid");
	int resp_pid = responsible ? responsible(self) : -1;
	pid_path(resp_pid, resp_exe);
	manager_name(manager, sizeof manager);
	SecuritySessionId session_id = 0;
	SessionAttributeBits session_bits = 0;
	OSStatus session_status = SessionGetInfo(callerSecuritySession, &session_id, &session_bits);
	auditinfo_addr_t audit;
	memset(&audit, 0, sizeof audit);
	int audit_rc = getaudit_addr(&audit, sizeof audit);
	int ax = AXIsProcessTrusted() ? 1 : 0;
	int sr = CGPreflightScreenCaptureAccess() ? 1 : 0;
	int im = CGPreflightListenEventAccess() ? 1 : 0;
	int prompted = 0;
	if (strcmp(prompt, "ax") == 0 || strcmp(prompt, "all") == 0) { prompt_accessibility(); prompted = 1; }
	if (strcmp(prompt, "all") == 0) { CGRequestScreenCaptureAccess(); CGRequestListenEventAccess(); }

	char tmp[4096];
	snprintf(tmp, sizeof tmp, "%s.tmp", result);
	FILE *f = fopen(tmp, "w");
	if (!f) { perror("report: open result"); return 3; }
	fprintf(f, "{\"marker\":"); put_str(f, SPT_MARKER);
	fprintf(f, ",\"tag\":"); put_str(f, arg_value(argc, argv, "--tag"));
	fprintf(f, ",\"hostPidArg\":"); put_str(f, arg_value(argc, argv, "--host-pid"));
	fprintf(f, ",\"pid\":%d,\"ppid\":%d,\"uid\":%d,\"exe\":", self, getppid(), getuid()); put_str(f, exe);
	fprintf(f, ",\"responsibleSymbol\":%s,\"responsiblePid\":%d,\"responsibleExe\":", responsible ? "true" : "false", resp_pid); put_str(f, resp_exe);
	fprintf(f, ",\"managerName\":"); put_str(f, manager);
	fprintf(f, ",\"securitySession\":{\"status\":%d,\"id\":%u,\"attrs\":%u,\"hasGraphicAccess\":%s,\"isRemote\":%s,\"hasTTY\":%s}",
		(int)session_status, (unsigned)session_id, (unsigned)session_bits,
		(session_bits & sessionHasGraphicAccess) ? "true" : "false",
		(session_bits & sessionIsRemote) ? "true" : "false",
		(session_bits & sessionHasTTY) ? "true" : "false");
	fprintf(f, ",\"auditSessionId\":%d", audit_rc == 0 ? (int)audit.ai_asid : -1);
	fprintf(f, ",\"preflight\":{\"accessibility\":%d,\"screenRecording\":%d,\"inputMonitoring\":%d},\"prompted\":%s", ax, sr, im, prompted ? "true" : "false");
	fprintf(f, ",\"ancestry\":[");
	pid_t walk = self;
	for (int depth = 0; depth < 8 && walk > 0; depth++) {
		char path[PROC_PIDPATHINFO_MAXSIZE];
		pid_path(walk, path);
		if (depth) fputc(',', f);
		fprintf(f, "{\"pid\":%d,\"exe\":", walk); put_str(f, path); fputc('}', f);
		if (walk == 1) break;
		walk = parent_of(walk);
	}
	fprintf(f, "],\"time\":%ld}\n", (long)time(NULL));
	fclose(f);
	if (rename(tmp, result) != 0) { perror("report: rename"); return 3; }
	return 0;
}

/* spawn disclaim|plain <exe> [args...]: posix_spawn the launcher, print one JSON line, reap it */
static int spawn_child(int argc, char **argv) {
	if (argc < 4) { fprintf(stderr, "spawn: spawn disclaim|plain <exe> [args...]\n"); return 2; }
	int disclaim = strcmp(argv[2], "disclaim") == 0;
	posix_spawnattr_t attr;
	posix_spawnattr_init(&attr);
	int disclaim_rc = 0;
	if (disclaim) {
		disclaim_fn set_disclaim = (disclaim_fn)dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim");
		if (!set_disclaim) { printf("{\"spawned\":false,\"error\":\"symbol_missing\",\"symbol\":\"responsibility_spawnattrs_setdisclaim\"}\n"); return 3; }
		disclaim_rc = set_disclaim(&attr, 1);
	}
	pid_t child = 0;
	int rc = posix_spawn(&child, argv[3], NULL, &attr, &argv[3], environ);
	posix_spawnattr_destroy(&attr);
	printf("{\"spawned\":%s,\"mode\":\"%s\",\"disclaimRc\":%d,\"spawnRc\":%d,\"pid\":%d,\"spawnerPid\":%d}\n",
		rc == 0 ? "true" : "false", disclaim ? "disclaim" : "plain", disclaim_rc, rc, (int)child, (int)getpid());
	fflush(stdout);
	if (rc != 0) return 4;
	int status = 0;
	waitpid(child, &status, 0);
	return WIFEXITED(status) ? WEXITSTATUS(status) : 5;
}

static FILE *tap_out;
static CGEventRef tap_cb(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *ctx) {
	(void)proxy; (void)ctx;
	if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
		fprintf(tap_out, "{\"tapDisabled\":%d}\n", (int)type);
	} else {
		fprintf(tap_out, "{\"type\":%d,\"keycode\":%lld,\"sourcePid\":%lld,\"sourceStateId\":%lld,\"sourceUserData\":%lld}\n", (int)type,
			CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode),
			CGEventGetIntegerValueField(event, kCGEventSourceUnixProcessID),
			CGEventGetIntegerValueField(event, kCGEventSourceStateID),
			CGEventGetIntegerValueField(event, kCGEventSourceUserData));
	}
	fflush(tap_out);
	return event;
}

/* tap <seconds> <result>: listen-only session tap; one JSON line per key event (the untagged-route rows) */
static int tap_keys(int argc, char **argv) {
	if (argc < 4) { fprintf(stderr, "tap: tap <seconds> <result>\n"); return 2; }
	tap_out = fopen(argv[3], "w");
	if (!tap_out) { perror("tap: open result"); return 3; }
	CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp) | CGEventMaskBit(kCGEventFlagsChanged);
	CFMachPortRef port = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionListenOnly, mask, tap_cb, NULL);
	if (!port) { fprintf(tap_out, "{\"error\":\"tap_create_failed\"}\n"); fclose(tap_out); return 4; }
	CFRunLoopSourceRef source = CFMachPortCreateRunLoopSource(NULL, port, 0);
	CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
	CGEventTapEnable(port, true);
	fprintf(tap_out, "{\"tapReady\":true}\n");
	fflush(tap_out);
	CFRunLoopRunInMode(kCFRunLoopDefaultMode, atof(argv[2]), false);
	fclose(tap_out);
	return 0;
}

int main(int argc, char **argv) {
	if (argc >= 2 && strcmp(argv[1], "report") == 0) return report(argc, argv);
	if (argc >= 2 && strcmp(argv[1], "spawn") == 0) return spawn_child(argc, argv);
	if (argc >= 2 && strcmp(argv[1], "tap") == 0) return tap_keys(argc, argv);
	if (has_flag(argc, argv, "--version")) { printf("%s\n", SPT_MARKER); return 0; }
	fprintf(stderr, "usage: report --result <f> [--tag t] [--host-pid p] [--prompt ax|all] | spawn disclaim|plain <exe> [args] | tap <s> <f>\n");
	return 2;
}
C_SOURCE
}

compile() { # <out> <marker>
	write_source
	clang -O1 -Wall -Wno-deprecated-declarations -DSPT_MARKER="\"$2\"" -o "$1" "$workdir/probe.c" \
		-framework ApplicationServices -framework CoreGraphics -framework CoreFoundation -framework Security
}

case "${1:-}" in
spawner)
	[ $# -eq 2 ] || die "usage: spawner <out-binary>"
	mkdir -p "$(dirname "$2")"
	compile "$2" "spawner"
	codesign --force --sign - "$2" >/dev/null 2>&1
	echo "spawner=$2"
	;;
app)
	[ $# -eq 5 ] || die "usage: app <app-path> <bundle-id> <display-name> <marker>"
	app=$2 bundle_id=$3 display=$4 marker=$5
	: "${CU_RUN:?missing precondition: CU_RUN is not set}"
	signing="$CU_RUN/t3-signing"
	[ -s "$signing/IDENTITY.sha1" ] || die "missing precondition: T3 identity ($signing/IDENTITY.sha1); run sp-t-identity.sh create"
	keychain="$signing/t3.keychain-db"
	rm -rf "$app"
	mkdir -p "$app/Contents/MacOS"
	compile "$app/Contents/MacOS/omo-computer-engine" "$marker"
	cat >"$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key><string>$bundle_id</string>
	<key>CFBundleExecutable</key><string>omo-computer-engine</string>
	<key>CFBundleName</key><string>omo-computer-helper</string>
	<key>CFBundleDisplayName</key><string>$display</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>0.0.0</string>
	<key>CFBundleVersion</key><string>$marker</string>
	<key>LSUIElement</key><true/>
	<key>LSMinimumSystemVersion</key><string>13.0</string>
</dict>
</plist>
PLIST
	security unlock-keychain -p "$(cat "$signing/keychain-password")" "$keychain"
	codesign --force --timestamp=none --keychain "$keychain" --sign "$(cat "$signing/IDENTITY.sha1")" \
		--identifier "$bundle_id" "$app" >/dev/null 2>&1 || die "codesign failed for $app"
	codesign --verify --strict "$app" || die "codesign --verify failed for $app"
	cdhash=$(codesign -dvvv "$app" 2>&1 | sed -n 's/^CDHash=//p' | head -1)
	requirement=$(codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p' | head -1)
	echo "cdhash=$cdhash"
	echo "requirement=$requirement"
	;;
*)
	die "usage: sp-t-bundle.sh spawner <out> | app <app-path> <bundle-id> <display-name> <marker>"
	;;
esac
