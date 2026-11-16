#include "omo-keychain.h"

#include <string.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

// Which dialog an `approve` of a non-owned item would show (Q2, decided 2026-10-28): a partition list naming our team
// gives the plain access dialog; one naming only other teams gives the login-password dialog, which is never shown.
// The partition entry's description is a hex-encoded property list {"Partitions": ["teamid:...", ...]}.

static CFDataRef hex_to_data(CFStringRef hex) {
  char text[4096];
  if (!CFStringGetCString(hex, text, sizeof text, kCFStringEncodingASCII)) return NULL;
  size_t length = strlen(text);
  if (length % 2 != 0) return NULL;
  UInt8 bytes[2048];
  for (size_t i = 0; i < length; i += 2) {
    unsigned int byte = 0;
    for (size_t j = 0; j < 2; j++) {
      char h = text[i + j];
      byte <<= 4;
      if (h >= '0' && h <= '9') byte |= (unsigned int)(h - '0');
      else if (h >= 'a' && h <= 'f') byte |= (unsigned int)(h - 'a' + 10);
      else if (h >= 'A' && h <= 'F') byte |= (unsigned int)(h - 'A' + 10);
      else return NULL;
    }
    bytes[i / 2] = (UInt8)byte;
  }
  return CFDataCreate(NULL, bytes, (CFIndex)(length / 2));
}

const char *classify_partition_description(CFStringRef description) {
  CFDataRef data = description == NULL ? NULL : hex_to_data(description);
  if (data == NULL) return "unknown";
  CFPropertyListRef plist = CFPropertyListCreateWithData(NULL, data, kCFPropertyListImmutable, NULL, NULL);
  CFRelease(data);
  if (plist == NULL || CFGetTypeID(plist) != CFDictionaryGetTypeID()) {
    if (plist != NULL) CFRelease(plist);
    return "unknown";
  }
  CFArrayRef partitions = CFDictionaryGetValue(plist, CFSTR("Partitions"));
  const char *kind = "unknown";
  if (partitions != NULL && CFGetTypeID(partitions) == CFArrayGetTypeID()) {
    kind = "other";
    CFStringRef ours = CFStringCreateWithCString(NULL, "teamid:" OMO_KEYCHAIN_TEAM, kCFStringEncodingUTF8);
    for (CFIndex i = 0; i < CFArrayGetCount(partitions); i++) {
      CFTypeRef entry = CFArrayGetValueAtIndex(partitions, i);
      if (CFGetTypeID(entry) == CFStringGetTypeID() && CFStringCompare(entry, ours, 0) == kCFCompareEqualTo) kind = "ours";
    }
    CFRelease(ours);
  }
  CFRelease(plist);
  return kind;
}

const char *partition_kind(SecKeychainItemRef item) {
  SecAccessRef access = NULL;
  if (item == NULL || SecKeychainItemCopyAccess(item, &access) != errSecSuccess) return "unknown";
  CFArrayRef acls = SecAccessCopyMatchingACLList(access, CFSTR("ACLAuthorizationPartitionID"));
  CFRelease(access);
  if (acls == NULL) return "none";
  const char *kind = CFArrayGetCount(acls) == 0 ? "none" : "unknown";
  for (CFIndex i = 0; i < CFArrayGetCount(acls); i++) {
    CFArrayRef apps = NULL;
    CFStringRef description = NULL;
    SecKeychainPromptSelector selector;
    if (SecACLCopyContents((SecACLRef)CFArrayGetValueAtIndex(acls, i), &apps, &description, &selector) != errSecSuccess)
      continue;
    const char *entry = classify_partition_description(description);
    if (strcmp(kind, "ours") != 0) kind = entry;
    if (apps != NULL) CFRelease(apps);
    if (description != NULL) CFRelease(description);
  }
  CFRelease(acls);
  return kind;
}
