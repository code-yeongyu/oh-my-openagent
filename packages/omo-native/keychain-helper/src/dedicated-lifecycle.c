#define __STDC_WANT_LIB_EXT1__ 1
#include <string.h>

#include "dedicated.h"

#include <CoreServices/CoreServices.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

static bool remove_lock_files(const char *root);

static void remove_partial(const char *dir) {
  char path[DEDICATED_PATH_BYTES];
  if (dedicated_join(path, sizeof path, dir, DEDICATED_KEYCHAIN_NAME)) unlink(path);
  if (dedicated_join(path, sizeof path, dir, DEDICATED_KEY_NAME)) unlink(path);
  remove_lock_files(dir);
  rmdir(dir);
}

// A store-create that crashed leaves `<root>.partial-<pid>` holding a key and keychain pair (review L4). Before the
// next create, every such folder owned by this user whose creating process is gone is removed.
static void remove_stale_partials(const char *root) {
  char parent[DEDICATED_PATH_BYTES], prefix[DEDICATED_PATH_BYTES];
  if ((size_t)snprintf(parent, sizeof parent, "%s", root) >= sizeof parent) return;
  char *slash = strrchr(parent, '/');
  if (slash == NULL) return;
  *slash = '\0';
  if ((size_t)snprintf(prefix, sizeof prefix, "%s.partial-", slash + 1) >= sizeof prefix) return;
  DIR *dir = opendir(parent);
  if (dir == NULL) return;
  size_t prefix_length = strlen(prefix);
  for (struct dirent *entry = readdir(dir); entry != NULL; entry = readdir(dir)) {
    if (strncmp(entry->d_name, prefix, prefix_length) != 0) continue;
    char *end = NULL;
    long pid = strtol(entry->d_name + prefix_length, &end, 10);
    if (end == NULL || *end != '\0' || pid <= 0 || (kill((pid_t)pid, 0) == 0 || errno != ESRCH)) continue;
    char path[DEDICATED_PATH_BYTES];
    struct stat info;
    if (!dedicated_join(path, sizeof path, parent, entry->d_name) || lstat(path, &info) != 0 || !S_ISDIR(info.st_mode) ||
        info.st_uid != geteuid())
      continue;
    remove_partial(path);
  }
  closedir(dir);
}

static const char *write_key(const char *dir, char key[DEDICATED_KEY_HEX]) {
  unsigned char random[DEDICATED_KEY_BYTES];
  if (SecRandomCopyBytes(kSecRandomDefault, sizeof random, random) != errSecSuccess) return "random";
  static const char digits[] = "0123456789abcdef";
  for (size_t i = 0; i < DEDICATED_KEY_BYTES; i++) {
    key[i * 2] = digits[random[i] >> 4];
    key[i * 2 + 1] = digits[random[i] & 0x0f];
  }
  memset_s(random, sizeof random, 0, sizeof random);
  char path[DEDICATED_PATH_BYTES];
  if (!dedicated_join(path, sizeof path, dir, DEDICATED_KEY_NAME)) return "path";
  int fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) return "key";
  bool written = fchmod(fd, 0600) == 0 && write(fd, key, DEDICATED_KEY_HEX) == DEDICATED_KEY_HEX && fsync(fd) == 0;
  close(fd);
  return written ? NULL : "key";
}

static const char *create_keychain(const char *dir, const char key[DEDICATED_KEY_HEX], OSStatus *status) {
  char path[DEDICATED_PATH_BYTES];
  if (!dedicated_join(path, sizeof path, dir, DEDICATED_KEYCHAIN_NAME)) return "path";
  SecKeychainRef keychain = NULL;
  if ((*status = SecKeychainCreate(path, DEDICATED_KEY_HEX, key, false, NULL, &keychain)) != errSecSuccess) return "create";
  // Locks on sleep and after five idle minutes; every request unlocks it again with the key.
  SecKeychainSettings settings = {SEC_KEYCHAIN_SETTINGS_VERS1, true, true, 300};
  *status = SecKeychainSetSettings(keychain, &settings);
  CFRelease(keychain);
  if (*status != errSecSuccess) return "settings";
  return chmod(path, 0600) == 0 ? NULL : "mode";
}

// Built in a private sibling directory and moved into place by one rename: a crash leaves no half-made store.
static const char *build_store(const char *partial, OSStatus *status) {
  if (mkdir(partial, 0700) != 0 || chmod(partial, 0700) != 0) return "mkdir";
  char key[DEDICATED_KEY_HEX];
  const char *refusal = write_key(partial, key);
  if (refusal == NULL) refusal = create_keychain(partial, key, status);
  memset_s(key, sizeof key, 0, sizeof key);
  if (refusal != NULL) return refusal;
  // The key sits beside the keychain, so the pair is kept out of Time Machine (sticky: excludeByPath false).
  CFURLRef url = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)partial, (CFIndex)strlen(partial), true);
  if (url == NULL || CSBackupSetItemExcluded(url, true, false) != noErr) refusal = "backup-exclude";
  if (url != NULL) CFRelease(url);
  return refusal;
}

static const char *ensure_parent(const char *root) {
  char parent[DEDICATED_PATH_BYTES];
  if ((size_t)snprintf(parent, sizeof parent, "%s", root) >= sizeof parent) return "path";
  char *slash = strrchr(parent, '/');
  if (slash == NULL || slash == parent) return "path";
  *slash = '\0';
  if (mkdir(parent, 0700) != 0 && errno != EEXIST) return "mkdir";
  return dedicated_check_parent(root);
}

// `store-create`: idempotent over a valid store, refuses over anything else at that path. The store starts inactive.
const char *dedicated_create(bool *created, OSStatus *status) {
  char root[DEDICATED_PATH_BYTES], partial[DEDICATED_PATH_BYTES + 32];
  *created = false;
  *status = errSecSuccess;
  if (!dedicated_root(root, sizeof root)) return "home";
  struct stat info;
  if (lstat(root, &info) == 0) return dedicated_open(status);
  const char *refusal = ensure_parent(root);
  if (refusal != NULL) return refusal;
  remove_stale_partials(root);
  snprintf(partial, sizeof partial, "%s.partial-%d", root, (int)getpid());
  refusal = build_store(partial, status);
  if (refusal == NULL && rename(partial, root) != 0) refusal = errno == EEXIST || errno == ENOTEMPTY ? "exists" : "rename";
  if (refusal != NULL) {
    remove_partial(partial);
    return refusal;
  }
  *created = true;
  return dedicated_open(status);
}

static bool present(const char *account) {
  item_state state = {0};
  bool found = lookup_attributes(account, &state) == errSecSuccess;
  item_state_release(&state);
  return found;
}

// `store-erase`: only an inactive store whose sign-in (<A>, <A>.staging) is gone is erased, so no sign-in is ever
// dropped here; leftover retired slots go with the file (r2 finding 8). Runs after dedicated_open().
const char *dedicated_erase(const char *account, OSStatus *status) {
  char root[DEDICATED_PATH_BYTES], path[DEDICATED_PATH_BYTES], staging[ACCOUNT_NAME_BYTES];
  *status = errSecSuccess;
  if (!dedicated_root(root, sizeof root)) return "home";
  if (dedicated_active()) return "active";
  snprintf(staging, sizeof staging, "%s.staging", account);
  if (present(account) || present(staging)) return "not-empty";
  if ((*status = SecKeychainDelete(store.keychain)) != errSecSuccess) return "delete";
  CFRelease(store.keychain);
  store.keychain = NULL;
  if (!dedicated_join(path, sizeof path, root, DEDICATED_KEY_NAME) || unlink(path) != 0) return "key";
  if (rmdir(root) != 0) return "rmdir";
  return NULL;
}

// Security leaves `.fl<hash>` lock files beside a keychain; only those, owned by this user, are removed here.
static bool remove_lock_files(const char *root) {
  DIR *dir = opendir(root);
  if (dir == NULL) return false;
  bool ok = true;
  for (struct dirent *entry = readdir(dir); entry != NULL; entry = readdir(dir)) {
    if (strncmp(entry->d_name, ".fl", 3) != 0) continue;
    char path[DEDICATED_PATH_BYTES];
    struct stat info;
    if (!dedicated_join(path, sizeof path, root, entry->d_name) || lstat(path, &info) != 0 || !S_ISREG(info.st_mode) ||
        info.st_uid != geteuid() || unlink(path) != 0)
      ok = false;
  }
  closedir(dir);
  return ok;
}

// `store-erase` after a crash between SecKeychainDelete and the folder removal (code review r1, LOW 2): the keychain
// file is already gone, so the store cannot be opened; an inactive, owner-only folder holding only the key is removed.
const char *dedicated_erase_leftover(void) {
  char root[DEDICATED_PATH_BYTES], path[DEDICATED_PATH_BYTES];
  if (!dedicated_root(root, sizeof root)) return "home";
  const char *refusal = dedicated_check_parent(root);
  struct stat info;
  if (refusal == NULL && (lstat(root, &info) != 0 || S_ISLNK(info.st_mode) || !S_ISDIR(info.st_mode) ||
                          info.st_uid != geteuid() || (info.st_mode & 07777) != 0700))
    refusal = "missing";
  if (refusal == NULL && dedicated_active()) refusal = "active";
  if (refusal == NULL && (!dedicated_join(path, sizeof path, root, DEDICATED_KEYCHAIN_NAME) || lstat(path, &info) == 0 || errno != ENOENT))
    refusal = "missing";
  if (refusal == NULL && (!dedicated_join(path, sizeof path, root, DEDICATED_KEY_NAME) || (unlink(path) != 0 && errno != ENOENT)))
    refusal = "key";
  if (refusal == NULL && (!remove_lock_files(root) || rmdir(root) != 0)) refusal = "rmdir";
  return refusal;
}
