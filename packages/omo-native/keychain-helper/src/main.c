#include "omo-keychain.h"

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

enum verb { VERB_READ, VERB_APPROVE, VERB_WRITE, VERB_STAGE, VERB_RETIRE, VERB_PROMOTE, VERB_REMOVE };

static const struct {
  const char *name;
  enum verb verb;
  bool mutates;
  bool takes_value;
} VERBS[] = {
    {"read", VERB_READ, false, false},     {"approve", VERB_APPROVE, false, false}, {"write", VERB_WRITE, true, true},
    {"stage", VERB_STAGE, true, true},     {"retire", VERB_RETIRE, true, false},    {"promote", VERB_PROMOTE, true, false},
    {"remove", VERB_REMOVE, true, false},
};

#ifdef OMO_KEYCHAIN_TEST_BUILD
static bool test_hold_before_reply = false;
static bool test_as_root = false;
#endif

static void refuse_argv(void) {
  static const char reply[] = "{\"error\":\"refused\",\"reason\":\"argv\"}\n";
  if (write(STDOUT_FILENO, reply, sizeof reply - 1) < 0) _exit(EXIT_REFUSED_ARGV);
  _exit(EXIT_REFUSED_ARGV);
}

// Release builds take no arguments at all: no keychain path, no flags (design 1, "Refusals"). The test-only flags exist
// only when OMO_KEYCHAIN_TEST_BUILD is defined, so their strings are absent from a release binary.
static void parse_argv(int argc, char **argv) {
#ifdef OMO_KEYCHAIN_TEST_BUILD
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--keychain") == 0 && i + 1 < argc && store.keychain == NULL) {
      if (SecKeychainOpen(argv[++i], &store.keychain) != errSecSuccess) refuse_argv();
    } else if (strcmp(argv[i], "--no-ui") == 0) store.no_ui = true;
    else if (strcmp(argv[i], "--hold-before-reply") == 0) test_hold_before_reply = true;
    else if (strcmp(argv[i], "--as-root") == 0) test_as_root = true;
    else if (strcmp(argv[i], "--classify-partition") == 0 && i + 1 < argc) {
      CFStringRef hex = CFStringCreateWithCString(NULL, argv[++i], kCFStringEncodingUTF8);
      printf("%s\n", classify_partition_description(hex));
      fflush(stdout);
      _exit(EXIT_DONE);
    } else refuse_argv();
  }
#else
  (void)argv;
  if (argc != 1) refuse_argv();
#endif
}

static bool running_as_root(void) {
#ifdef OMO_KEYCHAIN_TEST_BUILD
  if (test_as_root) return true;
#endif
  return geteuid() == 0;
}

static int find_verb(const buffer *name) {
  for (size_t i = 0; i < sizeof VERBS / sizeof VERBS[0]; i++)
    if (buffer_is(name, VERBS[i].name)) return (int)i;
  return -1;
}

static const char *validate(const request *req, int verb_index) {
  if (verb_index < 0) return "unknown-verb";
  bool account_ok = VERBS[verb_index].verb == VERB_REMOVE ? valid_remove_target(req->account.bytes, req->account.length)
                                                          : valid_base_account(req->account.bytes, req->account.length);
  if (!account_ok) return "account";
  if (VERBS[verb_index].takes_value != req->has_value) return req->has_value ? "extra-value" : "missing-value";
  if (req->has_value && req->value.length > MAX_VALUE_BYTES) return "too-large";
  if (OMO_KEYCHAIN_REFUSE_ROOT && running_as_root()) return "root";
  return NULL;
}

static void dispatch(enum verb verb, const request *req) {
  const char *account = req->account.bytes;
  char staging[ACCOUNT_NAME_BYTES];
  switch (verb) {
  case VERB_READ: verb_read(account); break;
  case VERB_APPROVE: verb_approve(account); break;
  case VERB_WRITE: verb_write(account, &req->value, NULL); break;
  case VERB_STAGE:
    snprintf(staging, sizeof staging, "%s.staging", account);
    verb_write(staging, &req->value, "staging");
    break;
  case VERB_RETIRE: verb_retire(account); break;
  case VERB_PROMOTE: verb_promote(account); break;
  case VERB_REMOVE: verb_remove(account); break;
  }
}

int main(int argc, char **argv) {
  signal(SIGHUP, SIG_IGN);
  signal(SIGINT, SIG_IGN);
  signal(SIGTERM, SIG_IGN);
  signal(SIGPIPE, SIG_IGN);
  parse_argv(argc, argv);
  set_interaction(false);

  buffer line = {0};
  const char *refusal = NULL;
  if (!read_request_line(&line, &refusal)) {
    if (refusal == NULL) _exit(EXIT_CLIENT_GONE);
    session_start(false);
    reply_error("refused", refusal, errSecSuccess);
    session_wait_for_client_exit();
    _exit(EXIT_REFUSED_REQUEST);
  }
  request req = {0};
  refusal = parse_request(line.bytes == NULL ? "" : line.bytes, line.length, &req);
  int verb_index = refusal == NULL ? find_verb(&req.verb) : -1;
  if (refusal == NULL) refusal = validate(&req, verb_index);

  session_start(refusal == NULL && VERBS[verb_index].mutates);
  if (refusal != NULL) {
    reply_error("refused", refusal, errSecSuccess);
    session_wait_for_client_exit();
    _exit(EXIT_REFUSED_REQUEST);
  }
#ifdef OMO_KEYCHAIN_TEST_BUILD
  if (test_hold_before_reply) {
    // EOF-watcher seam: a non-mutating verb never leaves this hold (the watcher exits on EOF); a mutating verb starts
    // its native call only after the client is gone, which proves the mutation still lands.
    fputs("held\n", stderr);
    fflush(stderr);
    session_wait_for_client_exit();
  }
#endif
  dispatch(VERBS[verb_index].verb, &req);
  session_wait_for_client_exit();
  _exit(EXIT_DONE);
}
