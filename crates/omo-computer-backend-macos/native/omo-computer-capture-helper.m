// omo-computer-capture-helper: the persistent ScreenCaptureKit capture helper of the macOS
// computer backend (cu-v3 row 41). One JSON request line on stdin; one JSON reply line on
// stdout followed by exactly `pngBytes` PNG bytes. Stills (`screenshot`) use SCScreenshotManager
// and are the only frames a model ever sees; `streamStart`/`streamFrame`/`streamStop` serve the
// user-facing preview lane; `recordStart`/`recordStop` write an H.264 file for computer.record.
// Never /usr/sbin/screencapture. EOF on stdin ends the helper.
//
// Build (macOS 14 or later):
//   clang -fobjc-arc -O2 -mmacosx-version-min=14.0 \
//     -framework Foundation -framework CoreGraphics -framework CoreMedia -framework CoreVideo \
//     -framework CoreImage -framework ImageIO -framework UniformTypeIdentifiers \
//     -framework ScreenCaptureKit -framework AVFoundation \
//     crates/omo-computer-backend-macos/native/omo-computer-capture-helper.m \
//     -o target/<profile>/omo-computer-capture-helper

#import <AVFoundation/AVFoundation.h>
#import <CoreImage/CoreImage.h>
#import <CoreMedia/CoreMedia.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

static const int64_t kDeadline = 5 * (int64_t)NSEC_PER_SEC;
static const int kRecordMaxFps = 15;

static void Reply(NSDictionary *fields, NSData *png) {
  NSMutableDictionary *reply = [fields mutableCopy];
  reply[@"pngBytes"] = @(png.length);
  NSData *line = [NSJSONSerialization dataWithJSONObject:reply options:0 error:nil];
  fwrite(line.bytes, 1, line.length, stdout);
  fputc('\n', stdout);
  if (png.length > 0) fwrite(png.bytes, 1, png.length, stdout);
  fflush(stdout);
}

static void Fail(id ident, NSString *error) { Reply(@{@"id" : ident, @"ok" : @NO, @"error" : error}, nil); }
static void Done(id ident) { Reply(@{@"id" : ident, @"ok" : @YES}, nil); }

static BOOL Wait(dispatch_semaphore_t done) {
  return dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, kDeadline)) == 0;
}

static NSData *PNGData(CGImageRef image) {
  NSMutableData *data = [NSMutableData data];
  CGImageDestinationRef dest = CGImageDestinationCreateWithData(
      (__bridge CFMutableDataRef)data, (__bridge CFStringRef)UTTypePNG.identifier, 1, NULL);
  if (dest == NULL) return nil;
  CGImageDestinationAddImage(dest, image, NULL);
  BOOL ok = CGImageDestinationFinalize(dest);
  CFRelease(dest);
  return ok ? data : nil;
}

static NSString *ErrorName(NSError *error) {
  return error.code == SCStreamErrorUserDeclined ? @"denied" : @"nullFrame";
}

// Shareable content, or nil with *error set ("denied" or "timeout").
static SCShareableContent *Content(NSString **error) {
  __block SCShareableContent *content = nil;
  __block NSError *failure = nil;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                                             onScreenWindowsOnly:NO
                                               completionHandler:^(SCShareableContent *c, NSError *e) {
                                                 content = c;
                                                 failure = e;
                                                 dispatch_semaphore_signal(done);
                                               }];
  if (!Wait(done)) {
    *error = @"timeout";
    return nil;
  }
  if (content == nil) *error = ErrorName(failure);
  return content;
}

static SCWindow *FindWindow(SCShareableContent *content, uint32_t number) {
  for (SCWindow *w in content.windows)
    if (w.windowID == number) return w;
  return nil;
}

static SCDisplay *FindDisplay(SCShareableContent *content, uint32_t number) {
  for (SCDisplay *d in content.displays)
    if (d.displayID == number) return d;
  return nil;
}

static SCStreamConfiguration *Config(SCContentFilter *filter, double longEdge, BOOL cursor) {
  SCStreamConfiguration *config = [SCStreamConfiguration new];
  CGRect rect = filter.contentRect;
  double scale = filter.pointPixelScale;
  double width = rect.size.width * scale, height = rect.size.height * scale;
  double fit = (longEdge > 0 && MAX(width, height) > longEdge) ? longEdge / MAX(width, height) : 1.0;
  config.width = (size_t)MAX(1.0, round(width * fit));
  config.height = (size_t)MAX(1.0, round(height * fit));
  config.showsCursor = cursor;
  config.captureResolution = SCCaptureResolutionBest;
  return config;
}

static void Screenshot(NSDictionary *request) {
  id ident = request[@"id"];
  NSString *error = nil;
  SCShareableContent *content = Content(&error);
  if (content == nil) return Fail(ident, error);
  NSDictionary *target = request[@"target"];
  BOOL window = [target[@"kind"] isEqual:@"window"];
  NSMutableArray<NSNumber *> *excluded = [NSMutableArray array];
  SCContentFilter *filter = nil;
  if (window) {
    SCWindow *w = FindWindow(content, [target[@"window"] unsignedIntValue]);
    if (w == nil) return Fail(ident, @"notFound");
    filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:w];
  } else {
    SCDisplay *display = FindDisplay(content, [target[@"display"] unsignedIntValue]);
    if (display == nil) return Fail(ident, @"notFound");
    NSSet *wanted = [NSSet setWithArray:request[@"exclude"] ?: @[]];
    NSMutableArray<SCWindow *> *skip = [NSMutableArray array];
    for (SCWindow *w in content.windows) {
      if ([wanted containsObject:@(w.windowID)]) {
        [skip addObject:w];
        [excluded addObject:@(w.windowID)];
      }
    }
    filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:skip];
  }
  SCStreamConfiguration *config = Config(filter, 0, [request[@"cursor"] boolValue]);
  __block CGImageRef image = NULL;
  __block NSError *failure = nil;
  __block BOOL abandoned = NO;
  NSObject *guard = [NSObject new];
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  [SCScreenshotManager captureImageWithFilter:filter
                                configuration:config
                            completionHandler:^(CGImageRef captured, NSError *e) {
                              @synchronized(guard) {
                                // After the timeout nobody reads the image: retain nothing.
                                if (abandoned) return;
                                if (captured != NULL) image = CGImageRetain(captured);
                                failure = e;
                              }
                              dispatch_semaphore_signal(done);
                            }];
  if (!Wait(done)) {
    @synchronized(guard) {
      abandoned = YES;
      if (image != NULL) CGImageRelease(image);
      image = NULL;
    }
    return Fail(ident, @"timeout");
  }
  if (image == NULL) return Fail(ident, ErrorName(failure));
  NSData *png = PNGData(image);
  CGImageRelease(image);
  if (png == nil) return Fail(ident, @"nullFrame");
  Reply(@{
    @"id" : ident,
    @"ok" : @YES,
    @"source" : @"screenshot",
    @"filter" : window ? @"window" : @"display",
    @"excluded" : excluded
  },
        png);
}

// The newest frame of one stream, and the optional H.264 writer the recording feeds.
@interface Sink : NSObject <SCStreamOutput>
@property(nonatomic, strong) SCStream *stream;
@property(nonatomic, strong) AVAssetWriter *writer;
@property(nonatomic, strong) AVAssetWriterInput *input;
@property(nonatomic) BOOL started;
- (CGImageRef)copyLatest;
@end

@implementation Sink {
  CGImageRef _latest;
  CIContext *_context;
}

- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)buffer ofType:(SCStreamOutputType)type {
  if (type != SCStreamOutputTypeScreen || !CMSampleBufferIsValid(buffer)) return;
  CVImageBufferRef pixels = CMSampleBufferGetImageBuffer(buffer);
  if (pixels == NULL) return;
  if (self.writer != nil) {
    if (!self.started) {
      [self.writer startWriting];
      [self.writer startSessionAtSourceTime:CMSampleBufferGetPresentationTimeStamp(buffer)];
      self.started = YES;
    }
    if (self.input.readyForMoreMediaData) [self.input appendSampleBuffer:buffer];
    return;
  }
  if (_context == nil) _context = [CIContext context];
  CIImage *ci = [CIImage imageWithCVPixelBuffer:pixels];
  CGImageRef image = [_context createCGImage:ci fromRect:ci.extent];
  @synchronized(self) {
    if (_latest != NULL) CGImageRelease(_latest);
    _latest = image;
  }
}

- (CGImageRef)copyLatest {
  @synchronized(self) {
    return _latest != NULL ? CGImageRetain(_latest) : NULL;
  }
}

- (void)dealloc {
  if (_latest != NULL) CGImageRelease(_latest);
}
@end

static NSMutableDictionary<NSNumber *, Sink *> *gStreams;
static Sink *gRecording;
static dispatch_queue_t gOutput;

static BOOL Start(Sink *sink, SCContentFilter *filter, SCStreamConfiguration *config) {
  sink.stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:nil];
  NSError *error = nil;
  if (![sink.stream addStreamOutput:sink type:SCStreamOutputTypeScreen sampleHandlerQueue:gOutput error:&error])
    return NO;
  __block BOOL ok = NO;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  [sink.stream startCaptureWithCompletionHandler:^(NSError *e) {
    ok = e == nil;
    dispatch_semaphore_signal(done);
  }];
  return Wait(done) && ok;
}

static void Stop(Sink *sink) {
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  [sink.stream stopCaptureWithCompletionHandler:^(NSError *e) {
    (void)e;
    dispatch_semaphore_signal(done);
  }];
  Wait(done);
}

static void StreamStart(NSDictionary *request) {
  id ident = request[@"id"];
  NSNumber *number = request[@"window"];
  if (gStreams[number] != nil) return Done(ident);
  NSString *error = nil;
  SCShareableContent *content = Content(&error);
  if (content == nil) return Fail(ident, error);
  SCWindow *w = FindWindow(content, number.unsignedIntValue);
  if (w == nil) return Fail(ident, @"notFound");
  SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:w];
  SCStreamConfiguration *config = Config(filter, [request[@"longEdge"] doubleValue], NO);
  config.minimumFrameInterval = CMTimeMake(1, MAX(1, [request[@"fps"] intValue]));
  Sink *sink = [Sink new];
  if (!Start(sink, filter, config)) return Fail(ident, @"nullFrame");
  gStreams[number] = sink;
  Done(ident);
}

static void StreamFrame(NSDictionary *request) {
  id ident = request[@"id"];
  Sink *sink = gStreams[request[@"window"]];
  if (sink == nil) return Fail(ident, @"notFound");
  CGImageRef image = [sink copyLatest];
  if (image == NULL) return Fail(ident, @"nullFrame");
  NSData *png = PNGData(image);
  CGImageRelease(image);
  if (png == nil) return Fail(ident, @"nullFrame");
  Reply(@{@"id" : ident, @"ok" : @YES, @"source" : @"stream", @"filter" : @"window"}, png);
}

static void StreamStop(NSDictionary *request) {
  Sink *sink = gStreams[request[@"window"]];
  if (sink != nil) {
    Stop(sink);
    [gStreams removeObjectForKey:request[@"window"]];
  }
  Done(request[@"id"]);
}

static void RecordStart(NSDictionary *request) {
  id ident = request[@"id"];
  if (gRecording != nil) return Done(ident);
  NSString *error = nil;
  SCShareableContent *content = Content(&error);
  if (content == nil) return Fail(ident, error);
  SCDisplay *display = FindDisplay(content, CGMainDisplayID());
  if (display == nil) return Fail(ident, @"notFound");
  SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
  SCStreamConfiguration *config = Config(filter, 0, YES);
  int fps = MIN(kRecordMaxFps, MAX(1, [request[@"fps"] intValue]));
  config.minimumFrameInterval = CMTimeMake(1, fps);
  NSURL *url = [NSURL fileURLWithPath:request[@"path"]];
  NSError *failure = nil;
  Sink *sink = [Sink new];
  sink.writer = [AVAssetWriter assetWriterWithURL:url fileType:AVFileTypeQuickTimeMovie error:&failure];
  if (sink.writer == nil) return Fail(ident, @"nullFrame");
  sink.input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo
                                                  outputSettings:@{
                                                    AVVideoCodecKey : AVVideoCodecTypeH264,
                                                    AVVideoWidthKey : @(config.width),
                                                    AVVideoHeightKey : @(config.height)
                                                  }];
  sink.input.expectsMediaDataInRealTime = YES;
  [sink.writer addInput:sink.input];
  if (!Start(sink, filter, config)) return Fail(ident, @"nullFrame");
  gRecording = sink;
  Done(ident);
}

static void RecordStop(NSDictionary *request) {
  Sink *sink = gRecording;
  gRecording = nil;
  if (sink != nil) {
    Stop(sink);
    [sink.input markAsFinished];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    [sink.writer finishWritingWithCompletionHandler:^{
      dispatch_semaphore_signal(done);
    }];
    Wait(done);
  }
  Done(request[@"id"]);
}

int main(void) {
  @autoreleasepool {
    gStreams = [NSMutableDictionary dictionary];
    gOutput = dispatch_queue_create("omo.capture.output", DISPATCH_QUEUE_SERIAL);
    NSDictionary *ops = @{
      @"screenshot" : [NSValue valueWithPointer:(const void *)Screenshot],
      @"streamStart" : [NSValue valueWithPointer:(const void *)StreamStart],
      @"streamFrame" : [NSValue valueWithPointer:(const void *)StreamFrame],
      @"streamStop" : [NSValue valueWithPointer:(const void *)StreamStop],
      @"recordStart" : [NSValue valueWithPointer:(const void *)RecordStart],
      @"recordStop" : [NSValue valueWithPointer:(const void *)RecordStop],
    };
    char *line = NULL;
    size_t capacity = 0;
    while (getline(&line, &capacity, stdin) > 0) {
      @autoreleasepool {
        NSData *data = [NSData dataWithBytes:line length:strlen(line)];
        NSDictionary *request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (![request isKindOfClass:[NSDictionary class]]) continue;
        void (*op)(NSDictionary *) = (void (*)(NSDictionary *))[ops[request[@"op"]] pointerValue];
        if (op == NULL) {
          Fail(request[@"id"] ?: @0, @"notFound");
          continue;
        }
        op(request);
      }
    }
    free(line);
    for (Sink *sink in gStreams.allValues) Stop(sink);
    if (gRecording != nil) RecordStop(@{@"id" : @0});
  }
  return 0;
}
