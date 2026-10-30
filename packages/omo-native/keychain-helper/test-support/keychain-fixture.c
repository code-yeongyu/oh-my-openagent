// Test fixture for the keychain helper's tests: creates, locks and destroys a THROWAWAY keychain at an explicit path
// (dummy password), and acts as a second, foreign identity on it. It never opens the user's keychains.
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <stdio.h>
#include <string.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

static const char PASSWORD[] = "throwaway-dummy-password";

static CFMutableDictionaryRef item_query(SecKeychainRef keychain, const char *account, int searching) {
  CFMutableDictionaryRef query =
      CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(query, kSecAttrService, CFSTR("omo-cli"));
  CFDictionarySetValue(query, kSecAttrAccount, CFStringCreateWithCString(NULL, account, kCFStringEncodingUTF8));
  if (searching) {
    CFArrayRef list = CFArrayCreate(NULL, (const void **)&keychain, 1, &kCFTypeArrayCallBacks);
    CFDictionarySetValue(query, kSecMatchSearchList, list);
  } else CFDictionarySetValue(query, kSecUseKeychain, keychain);
  return query;
}

static int decrypt_apps(SecKeychainRef keychain, const char *account) {
  CFMutableDictionaryRef query = item_query(keychain, account, 1);
  CFDictionarySetValue(query, kSecReturnRef, kCFBooleanTrue);
  CFTypeRef item = NULL;
  OSStatus status = SecItemCopyMatching(query, &item);
  if (status != errSecSuccess) return printf("status %d\n", (int)status), 0;
  SecAccessRef access = NULL;
  SecKeychainItemCopyAccess((SecKeychainItemRef)item, &access);
  CFArrayRef acls = SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDecrypt);
  for (CFIndex i = 0; acls != NULL && i < CFArrayGetCount(acls); i++) {
    CFArrayRef apps = NULL;
    CFStringRef description = NULL;
    SecKeychainPromptSelector selector;
    SecACLCopyContents((SecACLRef)CFArrayGetValueAtIndex(acls, i), &apps, &description, &selector);
    printf("decrypt-apps %ld\n", apps == NULL ? -1L : (long)CFArrayGetCount(apps));
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 3) return fprintf(stderr, "usage: keychain-fixture <op> <keychain> [account] [value]\n"), 2;
  const char *op = argv[1], *path = argv[2], *account = argc > 3 ? argv[3] : "";
  SecKeychainSetUserInteractionAllowed(false);
  SecKeychainRef keychain = NULL;
  OSStatus status;
  if (strcmp(op, "create") == 0) {
    status = SecKeychainCreate(path, (UInt32)strlen(PASSWORD), PASSWORD, false, NULL, &keychain);
    if (status == errSecSuccess) {
      SecKeychainSettings settings = {SEC_KEYCHAIN_SETTINGS_VERS1, false, false, INT_MAX};
      status = SecKeychainSetSettings(keychain, &settings);
    }
    return printf("status %d\n", (int)status), status != errSecSuccess;
  }
  if ((status = SecKeychainOpen(path, &keychain)) != errSecSuccess) return printf("status %d\n", (int)status), 1;
  if (strcmp(op, "lock") == 0) status = SecKeychainLock(keychain);
  else if (strcmp(op, "unlock") == 0) status = SecKeychainUnlock(keychain, (UInt32)strlen(PASSWORD), PASSWORD, true);
  else if (strcmp(op, "destroy") == 0) status = SecKeychainDelete(keychain);
  else if (strcmp(op, "add") == 0 && argc > 4) {
    CFMutableDictionaryRef attributes = item_query(keychain, account, 0);
    CFDictionarySetValue(attributes, kSecValueData, CFDataCreate(NULL, (const UInt8 *)argv[4], (CFIndex)strlen(argv[4])));
    status = SecItemAdd(attributes, NULL);
  } else if (strcmp(op, "read") == 0) {
    CFMutableDictionaryRef query = item_query(keychain, account, 1);
    CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
    CFTypeRef data = NULL;
    status = SecItemCopyMatching(query, &data);
    if (status == errSecSuccess)
      printf("value %.*s\n", (int)CFDataGetLength(data), (const char *)CFDataGetBytePtr(data));
  } else if (strcmp(op, "delete") == 0) status = SecItemDelete(item_query(keychain, account, 1));
  else if (strcmp(op, "delete-interactive") == 0) {
    SecKeychainSetUserInteractionAllowed(true);
    status = SecItemDelete(item_query(keychain, account, 1));
  } else if (strcmp(op, "read-twice-interactive") == 0) {
    SecKeychainSetUserInteractionAllowed(true);
    for (int round = 0; round < 2; round++) {
      CFMutableDictionaryRef query = item_query(keychain, account, 1);
      CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
      CFTypeRef data = NULL;
      status = SecItemCopyMatching(query, &data);
      printf("round %d status %d\n", round + 1, (int)status);
    }
  }
  else if (strcmp(op, "decrypt-apps") == 0) return decrypt_apps(keychain, account);
  else return fprintf(stderr, "unknown op %s\n", op), 2;
  printf("status %d\n", (int)status);
  return 0;
}
