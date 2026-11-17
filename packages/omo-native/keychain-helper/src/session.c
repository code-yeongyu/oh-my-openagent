#include "omo-keychain.h"

#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <sys/event.h>
#include <time.h>
#include <unistd.h>

// The client is gone when its stdin reaches EOF or when the process that spawned the helper exits, whichever comes
// first: another process can inherit the write end of stdin, so EOF alone may never come (#14029). Before the reply, a
// non-mutating verb exits at once, which ends any dialog it holds; a mutating verb finishes its native call first, so a
// killed client never leaves a half-applied mutation (design 2 and 3.6, R2). That grace is bounded: a mutating call
// still blocked `limits.grace_ms` after the client left waits on a prompt nobody will answer, and while the helper
// lives it holds the session lock the client handed it. Every run also ends after `limits.lifetime_ms`, client or not.

helper_limits limits = {.lifetime_ms = 600000, .grace_ms = 30000};

static pthread_mutex_t state_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t state_changed = PTHREAD_COND_INITIALIZER;
static bool client_gone = false;
static bool replying = false;
static bool request_mutates = false;
static pid_t caller = 0;

static void mark_client_gone(void) {
  pthread_mutex_lock(&state_lock);
  client_gone = true;
  if (!replying && !request_mutates) _exit(EXIT_CLIENT_GONE);
  pthread_cond_broadcast(&state_changed);
  pthread_mutex_unlock(&state_lock);
}

static void *watch_stdin(void *unused) {
  (void)unused;
  char sink[256];
  for (;;) {
    ssize_t got = read(STDIN_FILENO, sink, sizeof sink);
    if (got > 0 || (got < 0 && errno == EINTR)) continue;
    break;
  }
  mark_client_gone();
  return NULL;
}

// NOTE_EXIT on the spawning process. Only ESRCH proves the caller already gone (as does a helper reparented to launchd
// before it looked); any other kqueue failure falls back to polling the parent pid, never to "gone".
static bool caller_exit_watched(void) {
  int queue = kqueue();
  if (queue < 0) return false;
  struct kevent change;
  struct kevent event;
  EV_SET(&change, (uintptr_t)caller, EVFILT_PROC, EV_ADD | EV_ONESHOT, NOTE_EXIT, 0, NULL);
  int got;
  do got = kevent(queue, &change, 1, &event, 1, NULL);
  while (got < 0 && errno == EINTR);
  int failure = got < 0 ? errno : (event.flags & EV_ERROR) != 0 ? (int)event.data : 0;
  close(queue);
  return failure == 0 || failure == ESRCH;
}

static void *watch_caller(void *unused) {
  (void)unused;
  if (caller > 1 && !caller_exit_watched())
    while (getppid() == caller) sleep(1);
  mark_client_gone();
  return NULL;
}

static long monotonic_ms(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return now.tv_sec * 1000L + now.tv_nsec / 1000000L;
}

// Waits on state_changed until `deadline` (monotonic ms) and exits there. Relative waits: a wall-clock step (sleep/wake,
// NTP) must not end a run early.
static void wait_or_exit_at(long deadline) {
  long left = deadline - monotonic_ms();
  if (left <= 0) _exit(EXIT_DEADLINE);
  struct timespec span = {.tv_sec = left / 1000, .tv_nsec = (left % 1000) * 1000000L};
  pthread_cond_timedwait_relative_np(&state_changed, &state_lock, &span);
}

// The main thread ends the process itself once its work is done; this thread only ends a run that overstays.
static void *watchdog(void *unused) {
  (void)unused;
  long deadline = monotonic_ms() + limits.lifetime_ms;
  pthread_mutex_lock(&state_lock);
  while (!client_gone) wait_or_exit_at(deadline);
  long grace = monotonic_ms() + limits.grace_ms;
  if (grace < deadline) deadline = grace;
  for (;;) wait_or_exit_at(deadline);
}

static void start_thread(void *(*body)(void *)) {
  pthread_t thread;
  pthread_create(&thread, NULL, body, NULL);
  pthread_detach(thread);
}

void session_start(bool mutates) {
  pthread_mutex_lock(&state_lock);
  request_mutates = mutates;
  caller = getppid();
  pthread_mutex_unlock(&state_lock);
  start_thread(watchdog);
  start_thread(watch_stdin);
  start_thread(watch_caller);
}

void session_wait_for_client_exit(void) {
  pthread_mutex_lock(&state_lock);
  while (!client_gone) pthread_cond_wait(&state_changed, &state_lock);
  pthread_mutex_unlock(&state_lock);
}

static void write_all(const char *bytes, size_t length) {
  while (length > 0) {
    ssize_t written = write(STDOUT_FILENO, bytes, length);
    if (written < 0) {
      if (errno == EINTR) continue;
      return;
    }
    bytes += written;
    length -= (size_t)written;
  }
}

void send_reply(buffer *reply) {
  pthread_mutex_lock(&state_lock);
  replying = true;
  pthread_mutex_unlock(&state_lock);
  buffer_text(reply, "}\n");
  write_all(reply->bytes, reply->length);
}

void reply_error(const char *code, const char *reason, OSStatus status) {
  buffer reply = {0};
  buffer_open_object(&reply);
  buffer_field_string(&reply, "error", code);
  if (reason != NULL) buffer_field_string(&reply, "reason", reason);
  if (status != errSecSuccess) buffer_field_number(&reply, "status", (double)status, "%.0f");
  send_reply(&reply);
  free(reply.bytes);
}

void reply_ok(const char *flag) {
  buffer reply = {0};
  buffer_open_object(&reply);
  buffer_field_bool(&reply, "ok", true);
  if (flag != NULL) buffer_field_bool(&reply, flag, true);
  send_reply(&reply);
  free(reply.bytes);
}
