#ifndef OMO_KEYCHAIN_H
#define OMO_KEYCHAIN_H

#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <stdbool.h>
#include <stddef.h>

#ifndef OMO_KEYCHAIN_REFUSE_ROOT
#define OMO_KEYCHAIN_REFUSE_ROOT 0
#endif

#define SERVICE "omo-cli"
#define OMO_KEYCHAIN_TEAM "523JNR86LZ"
#define MARKER "omo-owner/1"
#define MAX_VALUE_BYTES 65536
#define MAX_LINE_BYTES (MAX_VALUE_BYTES * 6 + 1024)
#define ACCOUNT_NAME_BYTES 80

enum exit_code { EXIT_DONE = 0, EXIT_REFUSED_ARGV = 2, EXIT_REFUSED_REQUEST = 3, EXIT_CLIENT_GONE = 4 };

typedef struct {
  char *bytes;
  size_t length;
  size_t capacity;
} buffer;

void buffer_put(buffer *out, const char *bytes, size_t length);
void buffer_text(buffer *out, const char *text);
void buffer_json_string(buffer *out, const unsigned char *bytes, size_t length);
void buffer_open_object(buffer *out);
void buffer_field_bool(buffer *out, const char *name, bool value);
void buffer_field_string(buffer *out, const char *name, const char *value);
void buffer_field_number(buffer *out, const char *name, double value, const char *format);
void buffer_field_bytes(buffer *out, const char *name, const unsigned char *bytes, size_t length);

typedef struct {
  bool has_v, has_verb, has_account, has_value;
  buffer verb, account, value;
} request;

bool read_request_line(buffer *line, const char **refusal);
const char *parse_request(const char *line, size_t length, request *req);
bool valid_base_account(const char *account, size_t length);
bool valid_remove_target(const char *account, size_t length);

typedef struct {
  SecKeychainRef keychain;
  bool no_ui;
} store_options;
extern store_options store;

typedef struct {
  bool marker;
  double cdat;
  double mdat;
  CFDataRef data;
  SecKeychainItemRef item;
} item_state;

void item_state_release(item_state *state);
void set_interaction(bool allowed);
bool target_keychain_locked(void);
bool item_keychain_locked(const char *account);
bool ui_available(void);
bool buffer_is(const buffer *value, const char *text);
OSStatus lookup_attributes(const char *account, item_state *state);
OSStatus read_data(const char *account, item_state *state);
OSStatus unlock_holder(SecKeychainItemRef item);
OSStatus add_owned(const char *account, const buffer *value);
OSStatus update_data(const char *account, const buffer *value);
OSStatus rename_item(const char *from, const char *to);
OSStatus delete_item(const char *account);

const char *classify_partition_description(CFStringRef description);
const char *partition_kind(SecKeychainItemRef item);

void session_start(bool mutates);
void session_wait_for_client_exit(void);
void send_reply(buffer *reply);
void reply_error(const char *code, const char *reason, OSStatus status);
void reply_ok(const char *flag);

void verb_read(const char *base);
void verb_approve(const char *base);
void verb_write(const char *account, const buffer *value, const char *not_owned_reason);
void verb_retire(const char *base);
void verb_promote(const char *base);
void verb_remove(const char *account);

#endif
