#include "omo-keychain.h"

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// One flat JSON object {"v":1,"verb":"...","account":"...","value":"..."}. Unknown or duplicate keys, any other `v`,
// trailing bytes and malformed JSON are refused, so the helper never guesses at a request it does not understand.

typedef struct {
  const char *at;
  const char *end;
} cursor;

static void skip_space(cursor *c) {
  while (c->at < c->end && (*c->at == ' ' || *c->at == '\t' || *c->at == '\r')) c->at++;
}

static bool append_utf8(buffer *out, unsigned long code) {
  char bytes[4];
  size_t length;
  if (code < 0x80) {
    bytes[0] = (char)code;
    length = 1;
  } else if (code < 0x800) {
    bytes[0] = (char)(0xc0 | (code >> 6));
    bytes[1] = (char)(0x80 | (code & 0x3f));
    length = 2;
  } else if (code < 0x10000) {
    bytes[0] = (char)(0xe0 | (code >> 12));
    bytes[1] = (char)(0x80 | ((code >> 6) & 0x3f));
    bytes[2] = (char)(0x80 | (code & 0x3f));
    length = 3;
  } else {
    bytes[0] = (char)(0xf0 | (code >> 18));
    bytes[1] = (char)(0x80 | ((code >> 12) & 0x3f));
    bytes[2] = (char)(0x80 | ((code >> 6) & 0x3f));
    bytes[3] = (char)(0x80 | (code & 0x3f));
    length = 4;
  }
  buffer_put(out, bytes, length);
  return true;
}

static bool parse_hex4(cursor *c, unsigned long *code) {
  if (c->end - c->at < 4) return false;
  unsigned long value = 0;
  for (int i = 0; i < 4; i++) {
    char h = c->at[i];
    value <<= 4;
    if (h >= '0' && h <= '9') value |= (unsigned long)(h - '0');
    else if (h >= 'a' && h <= 'f') value |= (unsigned long)(h - 'a' + 10);
    else if (h >= 'A' && h <= 'F') value |= (unsigned long)(h - 'A' + 10);
    else return false;
  }
  c->at += 4;
  *code = value;
  return true;
}

static bool parse_unicode_escape(cursor *c, buffer *out) {
  unsigned long code;
  if (!parse_hex4(c, &code)) return false;
  if (code >= 0xdc00 && code <= 0xdfff) return false;
  if (code >= 0xd800 && code <= 0xdbff) {
    unsigned long low;
    if (c->end - c->at < 2 || c->at[0] != '\\' || c->at[1] != 'u') return false;
    c->at += 2;
    if (!parse_hex4(c, &low) || low < 0xdc00 || low > 0xdfff) return false;
    code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
  }
  return append_utf8(out, code);
}

static bool parse_string(cursor *c, buffer *out) {
  if (c->at >= c->end || *c->at != '"') return false;
  c->at++;
  buffer_text(out, "");
  while (c->at < c->end) {
    unsigned char ch = (unsigned char)*c->at++;
    if (ch == '"') return true;
    if (ch < 0x20) return false;
    if (ch != '\\') {
      buffer_put(out, (const char *)&ch, 1);
      continue;
    }
    if (c->at >= c->end) return false;
    const char escape = *c->at++;
    const char *plain = escape == '"' ? "\"" : escape == '\\' ? "\\" : escape == '/' ? "/" : escape == 'b' ? "\b"
                        : escape == 'f' ? "\f" : escape == 'n' ? "\n" : escape == 'r' ? "\r" : escape == 't' ? "\t" : NULL;
    if (plain != NULL) buffer_text(out, plain);
    else if (escape != 'u' || !parse_unicode_escape(c, out)) return false;
  }
  return false;
}

static const char *parse_version(cursor *c) {
  if (c->at >= c->end || *c->at != '1') return "unknown-v";
  c->at++;
  if (c->at < c->end && ((*c->at >= '0' && *c->at <= '9') || *c->at == '.' || *c->at == 'e' || *c->at == 'E'))
    return "unknown-v";
  return NULL;
}

static const char *parse_member(cursor *c, request *req) {
  buffer key = {0};
  const char *refusal = NULL;
  if (!parse_string(c, &key)) refusal = "malformed";
  skip_space(c);
  if (refusal == NULL && (c->at >= c->end || *c->at != ':')) refusal = "malformed";
  if (refusal == NULL) {
    c->at++;
    skip_space(c);
    bool *seen = NULL;
    buffer *target = NULL;
    if (buffer_is(&key, "v")) seen = &req->has_v;
    else if (buffer_is(&key, "verb")) seen = &req->has_verb, target = &req->verb;
    else if (buffer_is(&key, "account")) seen = &req->has_account, target = &req->account;
    else if (buffer_is(&key, "value")) seen = &req->has_value, target = &req->value;
    if (seen == NULL) refusal = "unknown-key";
    else if (*seen) refusal = "duplicate-key";
    else {
      *seen = true;
      if (target == NULL) refusal = parse_version(c);
      else if (!parse_string(c, target)) refusal = "malformed";
    }
  }
  free(key.bytes);
  return refusal;
}

const char *parse_request(const char *line, size_t length, request *req) {
  cursor c = {line, line + length};
  skip_space(&c);
  if (c.at >= c.end || *c.at != '{') return "malformed";
  c.at++;
  skip_space(&c);
  if (c.at < c.end && *c.at == '}') c.at++;
  else {
    for (;;) {
      skip_space(&c);
      const char *refusal = parse_member(&c, req);
      if (refusal != NULL) return refusal;
      skip_space(&c);
      if (c.at < c.end && *c.at == ',') {
        c.at++;
        continue;
      }
      if (c.at < c.end && *c.at == '}') {
        c.at++;
        break;
      }
      return "malformed";
    }
  }
  skip_space(&c);
  if (c.at != c.end) return "malformed";
  if (!req->has_v) return "unknown-v";
  if (!req->has_verb || !req->has_account) return "malformed";
  return NULL;
}

bool valid_base_account(const char *account, size_t length) {
  if (account == NULL || length != 64) return false;
  for (size_t i = 0; i < 64; i++) {
    char h = account[i];
    if (!((h >= '0' && h <= '9') || (h >= 'a' && h <= 'f'))) return false;
  }
  return true;
}

// Suffixed names are accepted only by `remove`; every other verb derives `<A>.staging` and the `<A>.old` slots itself.
bool valid_remove_target(const char *account, size_t length) {
  if (length == 64) return valid_base_account(account, length);
  if (length == 64 + 8 && strcmp(account + 64, ".staging") == 0) return valid_base_account(account, 64);
  if (length == 64 + 4 && strcmp(account + 64, ".old") == 0) return valid_base_account(account, 64);
  if (length == 64 + 6 && strncmp(account + 64, ".old.", 5) == 0 && account[69] >= '1' && account[69] <= '0' + OLD_SLOTS - 1)
    return valid_base_account(account, 64);
  return false;
}

bool read_request_line(buffer *line, const char **refusal) {
  for (;;) {
    char ch;
    ssize_t got = read(STDIN_FILENO, &ch, 1);
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) {
      *refusal = line->length == 0 ? NULL : "malformed";
      return false;
    }
    if (ch == '\n') return true;
    if (line->length >= MAX_LINE_BYTES) {
      *refusal = "too-large";
      return false;
    }
    buffer_put(line, &ch, 1);
  }
}
