#include "dedicated.h"

#include <string.h>

// Which keychain a request runs against (#13116 design r2):
//   no "store"       the login keychain, as before; refused while OmO's own keychain is active (an older client or a
//                    request that forgot the field must never write a second, diverging sign-in)
//   "store":"login"  the login keychain explicitly: the migration steps that run while the store is active
//   "store":"omo"    OmO's own keychain alone, and only while it is active (a reader that chose it just before a
//                    disable hears store-inactive, never "signed out"); any refusal is final, never the login keychain
//   "store":"omo-migrate"  OmO's own keychain whether or not it is active: the enable/disable copy steps only
bool store_select(store_step step, const request *req) {
  if (!req->has_store) {
    if (!dedicated_active()) return true;
    reply_error("store-refused", "store-required", errSecSuccess);
    return false;
  }
  bool migrating = buffer_is(&req->store, "omo-migrate");
  if (buffer_is(&req->store, "login") || (migrating && step != STORE_STEP_NONE)) {
    if (step == STORE_STEP_NONE) return true;
    reply_error("refused", "store", errSecSuccess);
    return false;
  }
  char root[DEDICATED_PATH_BYTES];
  if (!dedicated_root(root, sizeof root)) {
    reply_error("store-refused", "home", errSecSuccess);
    return false;
  }
  // Withdrawing the marker needs only the trusted root, never an openable keychain, so a damaged store can still be
  // turned off (`disable --discard`, review L1) and store-less requests reach the login keychain again.
  if (step == STORE_STEP_DEACTIVATE) {
    const char *refusal = dedicated_set_active(false);
    if (refusal != NULL) reply_error("store-refused", refusal, errSecSuccess);
    else reply_ok(NULL);
    return false;
  }
  if (step == STORE_STEP_NONE && !migrating && !dedicated_active()) {
    reply_error("store-refused", "store-inactive", errSecSuccess);
    return false;
  }
  OSStatus status = errSecSuccess;
  bool created = false;
  const char *refusal = step == STORE_STEP_CREATE ? dedicated_create(&created, &status) : dedicated_open(&status);
  if (step == STORE_STEP_ERASE && refusal != NULL && strcmp(refusal, "missing") == 0) {
    refusal = dedicated_erase_leftover();
    if (refusal == NULL) {
      reply_ok(NULL);
      return false;
    }
  }
  if (refusal == NULL && step == STORE_STEP_ACTIVATE) refusal = dedicated_set_active(true);
  if (refusal == NULL && step == STORE_STEP_DEACTIVATE) refusal = dedicated_set_active(false);
  if (refusal == NULL && step == STORE_STEP_ERASE) refusal = dedicated_erase(req->account.bytes, &status);
  if (refusal != NULL) {
    reply_error("store-refused", refusal, status);
    return false;
  }
  if (step == STORE_STEP_NONE) return true;
  reply_ok(step == STORE_STEP_CREATE ? (created ? "created" : "skipped") : NULL);
  return false;
}
