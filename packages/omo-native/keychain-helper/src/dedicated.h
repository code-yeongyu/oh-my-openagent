#ifndef OMO_KEYCHAIN_DEDICATED_H
#define OMO_KEYCHAIN_DEDICATED_H

#include "omo-keychain.h"

#define DEDICATED_KEYCHAIN_NAME "omo-credentials.keychain-db"
#define DEDICATED_KEY_NAME "unlock-key"
#define DEDICATED_ACTIVE_NAME "active"
#define DEDICATED_KEY_BYTES 32
#define DEDICATED_KEY_HEX (DEDICATED_KEY_BYTES * 2)
#define DEDICATED_PATH_BYTES 1024

bool dedicated_root(char *out, size_t size);
bool dedicated_join(char *out, size_t size, const char *dir, const char *name);
const char *dedicated_check_parent(const char *root);

#endif
