#include "omo-keychain.h"

#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <unistd.h>

// EOF on stdin only ever means the client died or exited. Before the reply, a non-mutating verb exits at once, which
// ends any dialog it holds; a mutating verb finishes its native call first, so a killed client never leaves a
// half-applied mutation (design 2 and 3.6, R2).

static pthread_mutex_t state_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t state_changed = PTHREAD_COND_INITIALIZER;
static bool client_gone = false;
static bool replying = false;
static bool request_mutates = false;

static void *watch_stdin(void *unused) {
  (void)unused;
  char sink[256];
  for (;;) {
    ssize_t got = read(STDIN_FILENO, sink, sizeof sink);
    if (got > 0 || (got < 0 && errno == EINTR)) continue;
    break;
  }
  pthread_mutex_lock(&state_lock);
  client_gone = true;
  if (!replying && !request_mutates) _exit(EXIT_CLIENT_GONE);
  pthread_cond_broadcast(&state_changed);
  pthread_mutex_unlock(&state_lock);
  return NULL;
}

void session_start(bool mutates) {
  pthread_mutex_lock(&state_lock);
  request_mutates = mutates;
  pthread_mutex_unlock(&state_lock);
  pthread_t watcher;
  pthread_create(&watcher, NULL, watch_stdin, NULL);
  pthread_detach(watcher);
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
