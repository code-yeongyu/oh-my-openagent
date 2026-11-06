#include "omo-keychain.h"

#include <Security/AuthSession.h>
#include <string.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

#define CF_EPOCH_OFFSET 978307200.0

store_options store = {NULL, false};

static CFStringRef cf_string(const char *text) { return CFStringCreateWithCString(NULL, text, kCFStringEncodingUTF8); }

static CFMutableDictionaryRef item_query(const char *account, bool searching) {
  CFMutableDictionaryRef query =
      CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFStringRef service = cf_string(SERVICE), name = cf_string(account);
  CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(query, kSecAttrService, service);
  CFDictionarySetValue(query, kSecAttrAccount, name);
  CFRelease(service);
  CFRelease(name);
  if (store.keychain != NULL) {
    if (searching) {
      CFArrayRef list = CFArrayCreate(NULL, (const void **)&store.keychain, 1, &kCFTypeArrayCallBacks);
      CFDictionarySetValue(query, kSecMatchSearchList, list);
      CFRelease(list);
    } else CFDictionarySetValue(query, kSecUseKeychain, store.keychain);
  }
  return query;
}

void item_state_release(item_state *state) {
  if (state->data != NULL) CFRelease(state->data);
  if (state->item != NULL) CFRelease(state->item);
  state->data = NULL;
  state->item = NULL;
}

static double date_seconds(CFDictionaryRef attributes, CFStringRef key) {
  CFDateRef date = CFDictionaryGetValue(attributes, key);
  if (date == NULL || CFGetTypeID(date) != CFDateGetTypeID()) return -1;
  return CFDateGetAbsoluteTime(date) + CF_EPOCH_OFFSET;
}

static bool has_marker(CFDictionaryRef attributes) {
  CFDataRef generic = CFDictionaryGetValue(attributes, kSecAttrGeneric);
  if (generic == NULL || CFGetTypeID(generic) != CFDataGetTypeID()) return false;
  size_t length = strlen(MARKER);
  return (size_t)CFDataGetLength(generic) == length && memcmp(CFDataGetBytePtr(generic), MARKER, length) == 0;
}

static OSStatus copy_matching(const char *account, CFBooleanRef with_data, item_state *state) {
  CFMutableDictionaryRef query = item_query(account, true);
  CFDictionarySetValue(query, kSecReturnAttributes, kCFBooleanTrue);
  CFDictionarySetValue(query, with_data == kCFBooleanTrue ? kSecReturnData : kSecReturnRef, kCFBooleanTrue);
  CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching(query, &result);
  CFRelease(query);
  if (status != errSecSuccess) return status;
  CFDictionaryRef attributes = result;
  state->marker = has_marker(attributes);
  state->cdat = date_seconds(attributes, kSecAttrCreationDate);
  state->mdat = date_seconds(attributes, kSecAttrModificationDate);
  if (with_data == kCFBooleanTrue) {
    CFDataRef data = CFDictionaryGetValue(attributes, kSecValueData);
    state->data = data == NULL ? CFDataCreate(NULL, NULL, 0) : (CFDataRef)CFRetain(data);
  } else {
    SecKeychainItemRef item = (SecKeychainItemRef)CFDictionaryGetValue(attributes, kSecValueRef);
    if (item != NULL) state->item = (SecKeychainItemRef)CFRetain(item);
  }
  CFRelease(result);
  return errSecSuccess;
}

// Attribute-only lookups are silent for any identity, on a locked keychain too (design 8, m2/m12).
OSStatus lookup_attributes(const char *account, item_state *state) { return copy_matching(account, kCFBooleanFalse, state); }

OSStatus read_data(const char *account, item_state *state) { return copy_matching(account, kCFBooleanTrue, state); }

bool target_keychain_locked(void) {
  SecKeychainRef keychain = store.keychain;
  if (keychain != NULL) CFRetain(keychain);
  else if (SecKeychainCopyDefault(&keychain) != errSecSuccess) return false;
  SecKeychainStatus status = 0;
  bool locked = SecKeychainGetStatus(keychain, &status) == errSecSuccess && (status & kSecUnlockStateStatus) == 0;
  CFRelease(keychain);
  return locked;
}

static SecKeychainRef copy_holder(const char *account) {
  item_state found = {0};
  SecKeychainRef holder = NULL;
  if (lookup_attributes(account, &found) == errSecSuccess && found.item != NULL) SecKeychainItemCopyKeychain(found.item, &holder);
  item_state_release(&found);
  return holder;
}

// Locked state of the keychain that holds <account>; for an item that does not exist yet, the one it would be added to.
bool item_keychain_locked(const char *account) {
  SecKeychainRef holder = copy_holder(account);
  if (holder == NULL) return target_keychain_locked();
  SecKeychainStatus status = 0;
  bool locked = SecKeychainGetStatus(holder, &status) == errSecSuccess && (status & kSecUnlockStateStatus) == 0;
  CFRelease(holder);
  return locked;
}

// Whether a dialog could be shown at all: not under --no-ui, and only in a security session with graphic access
// (an SSH or launchd-background session has none).
bool ui_available(void) {
  if (store.no_ui) return false;
  SecuritySessionId session = 0;
  SessionAttributeBits attributes = 0;
  return SessionGetInfo(callerSecuritySession, &session, &attributes) == errSecSuccess && (attributes & sessionHasGraphicAccess) != 0;
}

// (service, account) is unique within one keychain (-25299), so limiting the search list to the keychain that holds the
// probed item makes an update or delete act on exactly that item, never on a same-named item in another keychain.
static void scope_to_holder(CFMutableDictionaryRef query, const char *account) {
  if (store.keychain != NULL) return;
  SecKeychainRef holder = copy_holder(account);
  if (holder == NULL) return;
  CFArrayRef list = CFArrayCreate(NULL, (const void **)&holder, 1, &kCFTypeArrayCallBacks);
  CFDictionarySetValue(query, kSecMatchSearchList, list);
  CFRelease(list);
  CFRelease(holder);
}

void set_interaction(bool allowed) { SecKeychainSetUserInteractionAllowed(allowed && !store.no_ui); }

// `read` may show the unlock dialog of the keychain that holds the item, and nothing else: interaction is allowed only
// around SecKeychainUnlock without a password (design 2, `read`).
OSStatus unlock_holder(SecKeychainItemRef item) {
  SecKeychainRef holder = NULL;
  OSStatus status = SecKeychainItemCopyKeychain(item, &holder);
  if (status != errSecSuccess) return status;
  SecKeychainStatus keychain_status = 0;
  status = SecKeychainGetStatus(holder, &keychain_status);
  if (status == errSecSuccess && (keychain_status & kSecUnlockStateStatus) == 0) {
    set_interaction(true);
    status = SecKeychainUnlock(holder, 0, NULL, false);
    set_interaction(false);
  }
  CFRelease(holder);
  return status;
}

// The decrypt list holds the helper's own designated requirement and nothing else; never an "any application" entry.
static SecAccessRef owner_access(OSStatus *status) {
  SecTrustedApplicationRef self = NULL;
  *status = SecTrustedApplicationCreateFromPath(NULL, &self);
  if (*status != errSecSuccess) return NULL;
  CFArrayRef trusted = CFArrayCreate(NULL, (const void **)&self, 1, &kCFTypeArrayCallBacks);
  CFStringRef description = cf_string(SERVICE);
  SecAccessRef access = NULL;
  *status = SecAccessCreate(description, trusted, &access);
  CFRelease(description);
  CFRelease(trusted);
  CFRelease(self);
  return access;
}

static CFDataRef cf_bytes(const buffer *value) {
  return CFDataCreate(NULL, (const UInt8 *)(value->bytes == NULL ? "" : value->bytes), (CFIndex)value->length);
}

OSStatus add_owned(const char *account, const buffer *value) {
  OSStatus status;
  SecAccessRef access = owner_access(&status);
  if (access == NULL) return status;
  CFMutableDictionaryRef attributes = item_query(account, false);
  CFDataRef data = cf_bytes(value);
  CFDataRef marker = CFDataCreate(NULL, (const UInt8 *)MARKER, (CFIndex)strlen(MARKER));
  CFStringRef label = cf_string(SERVICE);
  CFDictionarySetValue(attributes, kSecValueData, data);
  CFDictionarySetValue(attributes, kSecAttrGeneric, marker);
  CFDictionarySetValue(attributes, kSecAttrAccess, access);
  CFDictionarySetValue(attributes, kSecAttrLabel, label);
  status = SecItemAdd(attributes, NULL);
  CFRelease(label);
  CFRelease(marker);
  CFRelease(data);
  CFRelease(attributes);
  CFRelease(access);
  return status;
}

static OSStatus update_item(const char *account, CFStringRef key, CFTypeRef value) {
  CFMutableDictionaryRef query = item_query(account, true);
  scope_to_holder(query, account);
  CFMutableDictionaryRef changes =
      CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFDictionarySetValue(changes, key, value);
  OSStatus status = SecItemUpdate(query, changes);
  CFRelease(changes);
  CFRelease(query);
  return status;
}

OSStatus update_data(const char *account, const buffer *value) {
  CFDataRef data = cf_bytes(value);
  OSStatus status = update_item(account, kSecValueData, data);
  CFRelease(data);
  return status;
}

// A rename keeps the item's access and marker (design 8, m10, r4-m5/m7); onto an existing account it is -25299.
OSStatus rename_item(const char *from, const char *to) {
  CFStringRef name = cf_string(to);
  OSStatus status = update_item(from, kSecAttrAccount, name);
  CFRelease(name);
  return status;
}

OSStatus delete_item(const char *account) {
  CFMutableDictionaryRef query = item_query(account, true);
  scope_to_holder(query, account);
  OSStatus status = SecItemDelete(query);
  CFRelease(query);
  return status;
}
