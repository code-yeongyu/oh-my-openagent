#include "omo-keychain.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

static void derived_name(char *out, const char *base, const char *suffix) {
  snprintf(out, ACCOUNT_NAME_BYTES, "%s%s", base, suffix);
}

// A locked keychain answers -25308 or, for some calls with interaction disabled, -25293: both are today's locked class.
// The lock state is the one of the keychain holding <account> (or receiving it, for an add).
static const char *failure_code_for(const char *account, OSStatus status) {
  bool locked = status == errSecInteractionNotAllowed || (status == errSecAuthFailed && item_keychain_locked(account));
  return locked ? "locked" : "store";
}

static void put_value(buffer *reply, const item_state *state) {
  buffer_field_bytes(reply, "value", CFDataGetBytePtr(state->data), (size_t)CFDataGetLength(state->data));
}

static void put_attributes(buffer *reply, const item_state *state) {
  buffer_field_bool(reply, "marker", state->marker);
  buffer_field_number(reply, "cdat", state->cdat, "%.3f");
  buffer_field_number(reply, "mdat", state->mdat, "%.3f");
}

// Presence of the migration names, from silent attribute-only lookups: recovery (design 3.4) needs to know which of
// <A>, <A>.staging and <A>.old exist without any dialog.
static void put_presence(buffer *reply, const char *base) {
  char staging[ACCOUNT_NAME_BYTES], old[ACCOUNT_NAME_BYTES];
  derived_name(staging, base, ".staging");
  derived_name(old, base, ".old");
  item_state s = {0}, o = {0};
  bool has_staging = lookup_attributes(staging, &s) == errSecSuccess;
  bool has_old = lookup_attributes(old, &o) == errSecSuccess;
  item_state_release(&s);
  item_state_release(&o);
  if (reply->length > 1) buffer_text(reply, ",");
  buffer_text(reply, has_staging ? "\"present\":{\"staging\":true" : "\"present\":{\"staging\":false");
  buffer_text(reply, has_old ? ",\"old\":true}" : ",\"old\":false}");
}

static bool unlock_or_reply(SecKeychainItemRef item) {
  if (item == NULL) return true;
  OSStatus status = unlock_holder(item);
  if (status == errSecSuccess) return true;
  bool locked = status == errSecInteractionNotAllowed || status == errSecAuthFailed || status == errSecUserCanceled;
  reply_error(locked ? "locked" : "store", NULL, status);
  return false;
}

static void read_original(const char *base, item_state *original) {
  if (!unlock_or_reply(original->item)) return;
  item_state data = {0};
  OSStatus status = read_data(base, &data);
  buffer reply = {0};
  buffer_open_object(&reply);
  if (status == errSecSuccess) {
    buffer_field_bool(&reply, "owned", true);
    put_value(&reply, &data);
    put_attributes(&reply, &data);
    put_presence(&reply, base);
    send_reply(&reply);
  } else if (status == errSecAuthFailed) {
    // Not owned: <A>'s attributes come from the silent lookup and staging is not consulted (design 2, `read`).
    buffer_field_bool(&reply, "owned", false);
    put_attributes(&reply, original);
    buffer_field_string(&reply, "partition", partition_kind(original->item));
    put_presence(&reply, base);
    send_reply(&reply);
  } else reply_error(failure_code_for(base, status), NULL, status);
  free(reply.bytes);
  item_state_release(&data);
}

static void read_staging(const char *base) {
  char staging[ACCOUNT_NAME_BYTES];
  derived_name(staging, base, ".staging");
  item_state staged = {0};
  OSStatus status = lookup_attributes(staging, &staged);
  buffer reply = {0};
  buffer_open_object(&reply);
  if (status == errSecItemNotFound) {
    buffer_field_bool(&reply, "missing", true);
    put_presence(&reply, base);
    send_reply(&reply);
  } else if (status != errSecSuccess) reply_error(failure_code_for(base, status), NULL, status);
  else if (unlock_or_reply(staged.item)) {
    item_state data = {0};
    status = read_data(staging, &data);
    if (status == errSecSuccess) {
      buffer_field_bool(&reply, "owned", true);
      put_value(&reply, &data);
      buffer_field_bool(&reply, "recover", true);
      put_attributes(&reply, &data);
      put_presence(&reply, base);
      send_reply(&reply);
    } else if (status == errSecAuthFailed) reply_error("not-owned", "staging", status);
    else reply_error(failure_code_for(base, status), NULL, status);
    item_state_release(&data);
  }
  free(reply.bytes);
  item_state_release(&staged);
}

void verb_read(const char *base) {
  item_state original = {0};
  OSStatus status = lookup_attributes(base, &original);
  if (status == errSecSuccess) read_original(base, &original);
  else if (status == errSecItemNotFound) read_staging(base);
  else reply_error(failure_code_for(base, status), NULL, status);
  item_state_release(&original);
}

static bool holder_locked(const char *account) {
  item_state found = {0};
  bool locked = false;
  if (lookup_attributes(account, &found) == errSecSuccess && found.item != NULL) {
    SecKeychainRef holder = NULL;
    SecKeychainStatus status = 0;
    if (SecKeychainItemCopyKeychain(found.item, &holder) == errSecSuccess) {
      locked = SecKeychainGetStatus(holder, &status) == errSecSuccess && (status & kSecUnlockStateStatus) == 0;
      CFRelease(holder);
    }
  }
  item_state_release(&found);
  return locked;
}

// The only verb that may show an access dialog (design 2, `approve`); it reads <A> and nothing else. A refusal while
// the holding keychain is locked is today's locked class (design 5, addendum row 18), never a denial.
void verb_approve(const char *base) {
  set_interaction(true);
  item_state data = {0};
  OSStatus status = read_data(base, &data);
  set_interaction(false);
  buffer reply = {0};
  buffer_open_object(&reply);
  if (status == errSecSuccess) {
    put_value(&reply, &data);
    put_attributes(&reply, &data);
    send_reply(&reply);
  } else if (status == errSecItemNotFound) {
    buffer_field_bool(&reply, "missing", true);
    send_reply(&reply);
  } else if (status == errSecInteractionNotAllowed || holder_locked(base) || (status == errSecAuthFailed && !ui_available()))
    // No dialog could be shown (--no-ui, or a session without graphic access such as SSH): today's locked class and
    // exit 7, never a "denied" the user did not give (design 2 and 5, headless row).
    reply_error("locked", NULL, status);
  else if (status == errSecUserCanceled || status == errSecAuthFailed) reply_error("denied", NULL, status);
  else reply_error(failure_code_for(base, status), NULL, status);
  free(reply.bytes);
  item_state_release(&data);
}

// An existing item is written only when the helper can read it silently, i.e. owns it; a non-owned item is never
// touched, so `write` and `stage` cannot leave a foreign access list behind a value we wrote.
static void update_owned(const char *account, const buffer *value, const char *not_owned_reason) {
  item_state probe = {0};
  OSStatus status = read_data(account, &probe);
  item_state_release(&probe);
  if (status == errSecAuthFailed && item_keychain_locked(account)) {
    reply_error("locked", NULL, status);
    return;
  }
  if (status == errSecAuthFailed) {
    reply_error("not-owned", not_owned_reason, status);
    return;
  }
  if (status == errSecSuccess) status = update_data(account, value);
  if (status == errSecSuccess) reply_ok(NULL);
  else reply_error(failure_code_for(account, status), NULL, status);
}

void verb_write(const char *account, const buffer *value, const char *not_owned_reason) {
  OSStatus status = add_owned(account, value);
  if (status == errSecSuccess) reply_ok("created");
  else if (status == errSecDuplicateItem) update_owned(account, value, not_owned_reason);
  else reply_error(failure_code_for(account, status), NULL, status);
}

static void rename_verb(const char *from, const char *to, bool skip_on_existing) {
  OSStatus status = rename_item(from, to);
  if (status == errSecSuccess) reply_ok(NULL);
  else if (status == errSecDuplicateItem && skip_on_existing) reply_ok("skipped");
  else if (status == errSecDuplicateItem) reply_error("exists", NULL, status);
  else if (status == errSecItemNotFound) reply_error("missing", NULL, status);
  else reply_error(failure_code_for(from, status), NULL, status);
}

void verb_retire(const char *base) {
  char old[ACCOUNT_NAME_BYTES];
  derived_name(old, base, ".old");
  rename_verb(base, old, true);
}

void verb_promote(const char *base) {
  char staging[ACCOUNT_NAME_BYTES];
  derived_name(staging, base, ".staging");
  rename_verb(staging, base, false);
}

void verb_remove(const char *account) {
  item_state probe = {0};
  OSStatus status = read_data(account, &probe);
  item_state_release(&probe);
  if (status == errSecItemNotFound) reply_ok("missing");
  else if (status == errSecAuthFailed && item_keychain_locked(account)) reply_error("locked", NULL, status);
  else if (status == errSecAuthFailed) reply_error("not-owned", NULL, status);
  else {
    if (status == errSecSuccess) status = delete_item(account);
    if (status == errSecSuccess) reply_ok(NULL);
    else reply_error(failure_code_for(account, status), NULL, status);
  }
}
