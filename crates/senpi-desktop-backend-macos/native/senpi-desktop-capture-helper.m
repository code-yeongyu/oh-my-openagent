// Persistent capture-only worker: one JSON request per line on stdin, one
// JSON header plus tightly packed premultiplied BGRA bytes per reply. AppKit
// owns the main run loop; no window is created and no temporary image file is
// used. The worker exits when its parent dies (DISPATCH_SOURCE_TYPE_PROC) and
// carries the engine's signing identity. It is staged at a fresh temp path on
// every engine start, so Screen Recording is charged to the responsible
// process (the app that launched OmO), not to this binary.
#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreVideo/CoreVideo.h>
#include <errno.h>
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static BOOL WriteAll(const void *bytes, size_t count) {
	const uint8_t *cursor = bytes;
	while (count) {
		ssize_t written = write(STDOUT_FILENO, cursor, count);
		if (written < 0 && errno == EINTR) continue;
		if (written <= 0) return NO;
		cursor += written;
		count -= (size_t)written;
	}
	return YES;
}

static void Header(NSDictionary *value) {
	NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
	if (!data || !WriteAll(data.bytes, data.length) || !WriteAll("\n", 1)) _exit(74);
}

static void Failure(NSString *code, NSString *message) {
	Header(@{ @"kind": @"error", @"code": code, @"error": message ?: @"Native capture failed" });
}

static void Unavailable(NSString *reason, NSString *message) {
	Header(@{ @"kind": @"error", @"code": @"CaptureUnavailable", @"reason": reason,
		@"error": message ?: @"The capture target is unavailable" });
}

// Every SCWindow whose ID is in `ids` or whose title matches one entry of `titles`.
static NSArray<SCWindow *> *ExcludedWindows(SCShareableContent *content, NSArray *titles, NSArray *ids) {
	BOOL hasTitles = [titles isKindOfClass:NSArray.class] && titles.count > 0;
	BOOL hasIds = [ids isKindOfClass:NSArray.class] && ids.count > 0;
	if (!hasTitles && !hasIds) return @[];
	NSMutableArray<SCWindow *> *excluded = [NSMutableArray new];
	for (SCWindow *window in content.windows) {
		if (hasIds && [ids containsObject:@(window.windowID)]) {
			[excluded addObject:window];
			continue;
		}
		if (!hasTitles) continue;
		NSString *title = window.title;
		if (title == nil || (id)title == NSNull.null || title.length == 0) continue;
		for (id entry in titles) {
			if ([entry isKindOfClass:NSString.class] && [title isEqualToString:entry]) {
				[excluded addObject:window];
				break;
			}
		}
	}
	return excluded;
}

// The first excludeWindowIds entry that WindowServer still lists but the shareable content does
// not, or 0. Such a helper could not be excluded, so the frame is refused rather than captured
// unfiltered; a helper that really closed is absent from both lists and is skipped (#10161).
// A window list that cannot be read counts as alive, so the check never fails open.
static uint32_t LiveMissingExclusion(SCShareableContent *content, NSArray *ids) {
	if (![ids isKindOfClass:NSArray.class]) return 0;
	for (id entry in ids) {
		if (![entry isKindOfClass:NSNumber.class]) continue;
		uint32_t wid = [entry unsignedIntValue];
		BOOL listed = NO;
		for (SCWindow *window in content.windows) {
			if (window.windowID == wid) { listed = YES; break; }
		}
		if (listed) continue;
		CFArrayRef info = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, wid);
		BOOL alive = info == NULL || CFArrayGetCount(info) > 0;
		if (info) CFRelease(info);
		if (alive) return wid;
	}
	return 0;
}

static void CaptureNext(SCShareableContent *content, NSArray *requests, NSUInteger index,
	uint64_t maxPixels, dispatch_block_t done) API_AVAILABLE(macos(14.0));

static void CaptureNext(SCShareableContent *content, NSArray *requests, NSUInteger index,
	uint64_t maxPixels, dispatch_block_t done) {
	if (index == requests.count) { done(); return; }
	NSDictionary *request = requests[index];
	NSString *kind = request[@"kind"];
	uint32_t identifier = [request[@"id"] unsignedIntValue];
	SCContentFilter *filter = nil;
	CGRect bounds = CGRectZero;
	BOOL onScreen = YES;
	pid_t ownerPid = 0;
	if ([kind isEqualToString:@"window"]) {
		for (SCWindow *window in content.windows) {
			if (window.windowID != identifier) continue;
			// isOnScreen is NO for a minimized window and for one on another Space alike;
			// the engine tells them apart through AXMinimized and refuses only the former.
			filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:window];
			ownerPid = window.owningApplication.processID;
			bounds = window.frame;
			onScreen = window.isOnScreen;
			break;
		}
	} else {
		uint32_t unexcludable = LiveMissingExclusion(content, request[@"excludeWindowIds"]);
		if (unexcludable != 0) {
			Failure(@"CaptureFailed", [NSString stringWithFormat:
				@"cursor helper window %u exists but is absent from the capture content; refusing an unfiltered frame",
				unexcludable]);
			done(); return;
		}
		for (SCDisplay *display in content.displays) {
			if (display.displayID != identifier) continue;
			filter = [[SCContentFilter alloc] initWithDisplay:display
				excludingWindows:ExcludedWindows(content, request[@"excludeWindowTitles"], request[@"excludeWindowIds"])];
			bounds = display.frame;
			break;
		}
	}
	if (!filter) {
		Failure([kind isEqualToString:@"window"] ? @"WindowNotFound" : @"InvalidTarget",
			@"Capture target is no longer available");
		done(); return;
	}
	double width = ceil(filter.contentRect.size.width * filter.pointPixelScale);
	double height = ceil(filter.contentRect.size.height * filter.pointPixelScale);
	if (!isfinite(width) || !isfinite(height) || width < 1 || height < 1 ||
		width > UINT32_MAX || height > UINT32_MAX || width * height > maxPixels) {
		Failure(@"CaptureFailed", @"Native screenshot dimensions exceed the safety limit");
		done(); return;
	}
	SCStreamConfiguration *configuration = [SCStreamConfiguration new];
	configuration.width = (size_t)width;
	configuration.height = (size_t)height;
	configuration.pixelFormat = kCVPixelFormatType_32BGRA;
	configuration.colorSpaceName = kCGColorSpaceSRGB;
	configuration.showsCursor = NO;
	configuration.ignoreShadowsSingleWindow = YES;
	configuration.ignoreGlobalClipSingleWindow = YES;
	[SCScreenshotManager captureImageWithFilter:filter configuration:configuration completionHandler:^(CGImageRef image, NSError *error) {
		@autoreleasepool {
			if (error || !image) {
				Failure(error.code == -3801 || error.code == -3803 ? @"PermissionDenied" : @"CaptureFailed",
					error.localizedDescription ?: @"ScreenCaptureKit returned no image");
				done(); return;
			}
			size_t pixelWidth = CGImageGetWidth(image), pixelHeight = CGImageGetHeight(image);
			if (!pixelWidth || !pixelHeight || pixelWidth > UINT32_MAX || pixelHeight > UINT32_MAX ||
				pixelWidth > maxPixels / pixelHeight || pixelWidth > SIZE_MAX / 4 / pixelHeight) {
				Failure(@"CaptureFailed", @"Native screenshot buffer exceeds the safety limit");
				done(); return;
			}
			size_t stride = pixelWidth * 4, length = stride * pixelHeight;
			NSMutableData *pixels = [NSMutableData dataWithLength:length];
			CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
			CGContextRef bitmap = space ? CGBitmapContextCreate(pixels.mutableBytes, pixelWidth, pixelHeight, 8, stride,
				space, kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little) : NULL;
			if (space) CGColorSpaceRelease(space);
			if (!bitmap) {
				Failure(@"CaptureFailed", @"Could not create the screenshot pixel buffer");
				done(); return;
			}
			CGContextDrawImage(bitmap, CGRectMake(0, 0, pixelWidth, pixelHeight), image);
			CGContextRelease(bitmap);
			Header(@{ @"kind": @"frame", @"index": @(index), @"width": @(pixelWidth), @"height": @(pixelHeight),
				@"byteLength": @(length), @"isOnScreen": @(onScreen), @"pid": @(ownerPid),
				@"bounds": @{ @"x": @(bounds.origin.x), @"y": @(bounds.origin.y),
					@"width": @(bounds.size.width), @"height": @(bounds.size.height) } });
			if (!WriteAll(pixels.bytes, pixels.length)) _exit(74);
			CaptureNext(content, requests, index + 1, maxPixels, done);
		}
	}];
}

static void Request(NSDictionary *request, dispatch_block_t done) {
	NSArray *targets = request[@"requests"];
	NSNumber *limit = request[@"maxPixels"];
	BOOL valid = [targets isKindOfClass:NSArray.class] && targets.count > 0 && targets.count <= 64 &&
		[limit isKindOfClass:NSNumber.class] && limit.unsignedLongLongValue > 0 && limit.unsignedLongLongValue <= 268435456;
	for (id target in valid ? targets : @[]) {
		if (![target isKindOfClass:NSDictionary.class]) { valid = NO; break; }
		id kind = target[@"kind"], identifier = target[@"id"];
		double number = [identifier isKindOfClass:NSNumber.class] ? [identifier doubleValue] : 0;
		if ((![@"window" isEqual:kind] && ![@"display" isEqual:kind]) || number < 1 || number > UINT32_MAX || floor(number) != number) {
			valid = NO; break;
		}
		id excluded = target[@"excludeWindowTitles"];
		if (excluded != nil && excluded != (id)NSNull.null && ![excluded isKindOfClass:NSArray.class]) {
			valid = NO; break;
		}
		id excludedIds = target[@"excludeWindowIds"];
		if (excludedIds != nil && excludedIds != (id)NSNull.null && ![excludedIds isKindOfClass:NSArray.class]) {
			valid = NO; break;
		}
		for (id entry in [excludedIds isKindOfClass:NSArray.class] ? excludedIds : @[]) {
			double value = [entry isKindOfClass:NSNumber.class] ? [entry doubleValue] : 0;
			if (![entry isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)entry) == CFBooleanGetTypeID() ||
				value < 1 || value > UINT32_MAX || floor(value) != value) { valid = NO; break; }
		}
		if (!valid) break;
	}
	if (!valid) { Failure(@"InvalidTarget", @"Malformed native capture request"); done(); return; }
	if (!CGPreflightScreenCaptureAccess()) {
		Failure(@"PermissionDenied", @"Screen Recording permission is not granted"); done(); return;
	}
	if (@available(macOS 14.0, *)) {
		[SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:NO completionHandler:^(SCShareableContent *content, NSError *error) {
			if (error || !content) {
				Failure(error.code == -3801 || error.code == -3803 ? @"PermissionDenied" : @"CaptureFailed",
					error.localizedDescription ?: @"ScreenCaptureKit returned no shareable content");
				done(); return;
			}
			CaptureNext(content, targets, 0, limit.unsignedLongLongValue, done);
		}];
	} else {
		Failure(@"Unsupported", @"ScreenCaptureKit capture worker requires macOS 14 or later"); done();
	}
}

static void Ready(dispatch_block_t done) {
	// Without the grant a content fetch could prompt; the capture that follows reports it.
	if (!CGPreflightScreenCaptureAccess()) {
		Header(@{ @"kind": @"ready" });
		done();
		return;
	}
	if (@available(macOS 14.0, *)) {
		[SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:NO completionHandler:^(SCShareableContent *content, NSError *error) {
			// Permission and content errors surface on the capture that follows.
			(void)content; (void)error;
			Header(@{ @"kind": @"ready" });
			done();
		}];
	} else {
		Header(@{ @"kind": @"ready" });
		done();
	}
}

int main(void) {
	@autoreleasepool {
		signal(SIGPIPE, SIG_IGN);
		[NSApplication sharedApplication];
		[NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
		(void)CGMainDisplayID();
		pid_t parent = getppid();
		__attribute__((objc_precise_lifetime)) dispatch_source_t death = dispatch_source_create(DISPATCH_SOURCE_TYPE_PROC, (uintptr_t)parent,
			DISPATCH_PROC_EXIT, dispatch_get_main_queue());
		if (death) { dispatch_source_set_event_handler(death, ^{ _exit(0); }); dispatch_resume(death); }
		dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
			char *line = NULL;
			size_t capacity = 0;
			ssize_t length;
			while ((length = getline(&line, &capacity, stdin)) > 0) {
				@autoreleasepool {
					if (length > 65536) { Failure(@"InvalidTarget", @"Native capture request is too large"); break; }
					NSData *data = [NSData dataWithBytes:line length:(NSUInteger)length];
					id request = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
					if (![request isKindOfClass:NSDictionary.class]) { Failure(@"InvalidTarget", @"Invalid capture request JSON"); continue; }
					dispatch_semaphore_t completed = dispatch_semaphore_create(0);
					if ([@"ping" isEqual:request[@"kind"]]) {
						// Warm-up: fetch shareable content once so the first capture is not cold.
						dispatch_async(dispatch_get_main_queue(), ^{ Ready(^{ dispatch_semaphore_signal(completed); }); });
						dispatch_semaphore_wait(completed, DISPATCH_TIME_FOREVER);
						continue;
					}
					dispatch_async(dispatch_get_main_queue(), ^{ Request(request, ^{ dispatch_semaphore_signal(completed); }); });
					dispatch_semaphore_wait(completed, DISPATCH_TIME_FOREVER);
				}
			}
			free(line);
			_exit(0);
		});
		[NSApp run];
		return 0;
	}
}
