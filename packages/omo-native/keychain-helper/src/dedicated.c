#define __STDC_WANT_LIB_EXT1__ 1
#include <string.h>

#include "dedicated.h"

#include <errno.h>
#include <fcntl.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

// OmO's own keychain for a Mac whose login keychain stays locked (#13116, opt-in, design r2). One owner-only directory:
//   <root>/omo-credentials.keychain-db  the keychain, 0600
//   <root>/unlock-key                   its password: 64 hex chars from SecRandomCopyBytes, 0600
//   <root>/active                       present only while the store is selected (written last, removed first)
// The helper opens it with SecKeychainOpen, which never adds it to the search list, and never changes the search list
// or the default keychain. Every check refuses by name; nothing is repaired and nothing falls back to the login keychain.

#define ROOT_SUFFIX "/Library/Application Support/OmO/credential-keychain"

const char *dedicated_root_override = NULL;

// This user's home from the password database. Test builds read HOME instead, so tests run in a throwaway home.
static const char *account_home(void) {
#ifdef OMO_KEYCHAIN_TEST_BUILD
  return getenv("HOME");
#else
  struct passwd *entry = getpwuid(geteuid());
  return entry == NULL ? NULL : entry->pw_dir;
#endif
}

static bool root_under(const char *home, char *out, size_t size) {
  if (dedicated_root_override != NULL) return (size_t)snprintf(out, size, "%s", dedicated_root_override) < size;
  if (home == NULL || home[0] != '/') return false;
  return (size_t)snprintf(out, size, "%s%s", home, ROOT_SUFFIX) < size;
}

// A request that names the store is served only when HOME is this user's home (r2 finding 7, delta L1).
bool dedicated_root(char *out, size_t size) {
  const char *home = getenv("HOME"), *account = account_home();
  if (dedicated_root_override == NULL && (home == NULL || account == NULL || strcmp(home, account) != 0)) return false;
  return root_under(account, out, size);
}

bool dedicated_join(char *out, size_t size, const char *dir, const char *name) {
  return (size_t)snprintf(out, size, "%s/%s", dir, name) < size;
}

// Owned by this user, of the expected kind, never a symlink, and exactly the expected mode.
static const char *check_entry(const char *path, bool directory, mode_t mode) {
  struct stat info;
  if (lstat(path, &info) != 0) return errno == ENOENT ? "missing" : "stat";
  if (S_ISLNK(info.st_mode)) return "symlink";
  if (directory ? !S_ISDIR(info.st_mode) : !S_ISREG(info.st_mode)) return "kind";
  if (info.st_uid != geteuid()) return "owner";
  if ((info.st_mode & 07777) != mode) return "mode";
  return NULL;
}

// Leaf checks mean nothing under a directory someone else can write to.
const char *dedicated_check_parent(const char *root) {
  char parent[DEDICATED_PATH_BYTES];
  if ((size_t)snprintf(parent, sizeof parent, "%s", root) >= sizeof parent) return "path";
  char *slash = strrchr(parent, '/');
  if (slash == NULL || slash == parent) return "path";
  *slash = '\0';
  struct stat info;
  if (lstat(parent, &info) != 0) return errno == ENOENT ? "missing" : "stat";
  if (!S_ISDIR(info.st_mode)) return "parent";
  if (info.st_uid != geteuid() || (info.st_mode & (S_IWGRP | S_IWOTH)) != 0) return "parent";
  return NULL;
}

static bool is_hex(const char *text, size_t length) {
  for (size_t i = 0; i < length; i++)
    if (!((text[i] >= '0' && text[i] <= '9') || (text[i] >= 'a' && text[i] <= 'f'))) return false;
  return true;
}

// Opened first, then checked through the descriptor, so the file checked is the file read.
static const char *read_key(const char *path, char key[DEDICATED_KEY_HEX]) {
  int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return errno == ENOENT ? "missing" : "key";
  struct stat info;
  const char *refusal = NULL;
  if (fstat(fd, &info) != 0 || !S_ISREG(info.st_mode) || info.st_uid != geteuid() || (info.st_mode & 07777) != 0600 ||
      info.st_nlink != 1 || info.st_size != DEDICATED_KEY_HEX)
    refusal = "key";
  size_t got = 0;
  while (refusal == NULL && got < DEDICATED_KEY_HEX) {
    ssize_t n = read(fd, key + got, DEDICATED_KEY_HEX - got);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) refusal = "key";
    else got += (size_t)n;
  }
  close(fd);
  if (refusal == NULL && !is_hex(key, DEDICATED_KEY_HEX)) refusal = "key";
  return refusal;
}

static const char *validate_layout(const char *root, char *keychain_path, size_t size, char key[DEDICATED_KEY_HEX]) {
  char key_path[DEDICATED_PATH_BYTES];
  if (!dedicated_join(keychain_path, size, root, DEDICATED_KEYCHAIN_NAME) ||
      !dedicated_join(key_path, sizeof key_path, root, DEDICATED_KEY_NAME))
    return "path";
  const char *refusal = dedicated_check_parent(root);
  if (refusal == NULL) refusal = check_entry(root, true, 0700);
  if (refusal == NULL) refusal = check_entry(keychain_path, false, 0600);
  if (refusal == NULL) refusal = read_key(key_path, key);
  return refusal;
}

// Selects the dedicated keychain for this request: validated, unlocked with its own key before any lookup, dialogs off.
const char *dedicated_open(OSStatus *status) {
  char root[DEDICATED_PATH_BYTES], keychain_path[DEDICATED_PATH_BYTES], key[DEDICATED_KEY_HEX];
  *status = errSecSuccess;
  if (!dedicated_root(root, sizeof root)) return "home";
  const char *refusal = validate_layout(root, keychain_path, sizeof keychain_path, key);
  SecKeychainRef keychain = NULL;
  if (refusal == NULL && (*status = SecKeychainOpen(keychain_path, &keychain)) != errSecSuccess) refusal = "open";
  if (refusal == NULL && (*status = SecKeychainUnlock(keychain, DEDICATED_KEY_HEX, key, true)) != errSecSuccess)
    refusal = "unlock";
  memset_s(key, sizeof key, 0, sizeof key);
  if (refusal != NULL) {
    if (keychain != NULL) CFRelease(keychain);
    return refusal;
  }
  store.keychain = keychain;
  store.no_ui = true;
  store.dedicated = true;
  set_interaction(false);
  return NULL;
}

// Whether the store is selected, looked up under the password-database home whatever HOME says, so a request that
// names no store cannot dodge the marker with another HOME (r2 finding 3, delta L1).
bool dedicated_active(void) {
  char root[DEDICATED_PATH_BYTES], marker[DEDICATED_PATH_BYTES];
  const char *home = account_home();
#ifndef OMO_KEYCHAIN_TEST_BUILD
  // Without a password-database home the marker cannot be checked, so the store is assumed active: a request that
  // names no store is refused rather than risk a second sign-in in the login keychain (code review r1, LOW 3).
  if (home == NULL && dedicated_root_override == NULL) return true;
#endif
  if (!root_under(home, root, sizeof root) || !dedicated_join(marker, sizeof marker, root, DEDICATED_ACTIVE_NAME))
    return false;
  struct stat info;
  return lstat(marker, &info) == 0;
}

// `store-activate` / `store-deactivate`: the marker is published by one rename and withdrawn by one unlink.
const char *dedicated_set_active(bool active) {
  char root[DEDICATED_PATH_BYTES], marker[DEDICATED_PATH_BYTES], staged[DEDICATED_PATH_BYTES + 32];
  if (!dedicated_root(root, sizeof root) || !dedicated_join(marker, sizeof marker, root, DEDICATED_ACTIVE_NAME)) return "path";
  if (!active) return unlink(marker) == 0 || errno == ENOENT ? NULL : "marker";
  snprintf(staged, sizeof staged, "%s.%d", marker, (int)getpid());
  int fd = open(staged, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) return "marker";
  bool synced = fchmod(fd, 0600) == 0 && fsync(fd) == 0;
  close(fd);
  if (!synced || rename(staged, marker) != 0) {
    unlink(staged);
    return "marker";
  }
  return NULL;
}
