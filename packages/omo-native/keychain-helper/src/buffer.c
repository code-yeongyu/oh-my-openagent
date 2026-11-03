#include "omo-keychain.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

void buffer_put(buffer *out, const char *bytes, size_t length) {
  if (out->length + length + 1 > out->capacity) {
    size_t capacity = out->capacity == 0 ? 256 : out->capacity;
    while (out->length + length + 1 > capacity) capacity *= 2;
    char *grown = realloc(out->bytes, capacity);
    if (grown == NULL) _exit(70);
    out->bytes = grown;
    out->capacity = capacity;
  }
  memcpy(out->bytes + out->length, bytes, length);
  out->length += length;
  out->bytes[out->length] = '\0';
}

void buffer_text(buffer *out, const char *text) { buffer_put(out, text, strlen(text)); }

void buffer_json_string(buffer *out, const unsigned char *bytes, size_t length) {
  buffer_text(out, "\"");
  for (size_t i = 0; i < length; i++) {
    unsigned char c = bytes[i];
    if (c == '"') buffer_text(out, "\\\"");
    else if (c == '\\') buffer_text(out, "\\\\");
    else if (c < 0x20 || c == 0x7f) {
      char escaped[8];
      snprintf(escaped, sizeof escaped, "\\u%04x", c);
      buffer_text(out, escaped);
    } else buffer_put(out, (const char *)&c, 1);
  }
  buffer_text(out, "\"");
}

void buffer_open_object(buffer *out) { buffer_text(out, "{"); }

// Length and bytes: a decoded string may hold an embedded NUL, which strcmp would stop at.
bool buffer_is(const buffer *value, const char *text) {
  size_t length = strlen(text);
  return value->bytes != NULL && value->length == length && memcmp(value->bytes, text, length) == 0;
}

static void field_name(buffer *out, const char *name) {
  if (out->length > 1) buffer_text(out, ",");
  buffer_json_string(out, (const unsigned char *)name, strlen(name));
  buffer_text(out, ":");
}

void buffer_field_bool(buffer *out, const char *name, bool value) {
  field_name(out, name);
  buffer_text(out, value ? "true" : "false");
}

void buffer_field_string(buffer *out, const char *name, const char *value) {
  field_name(out, name);
  buffer_json_string(out, (const unsigned char *)value, strlen(value));
}

void buffer_field_number(buffer *out, const char *name, double value, const char *format) {
  char number[64];
  snprintf(number, sizeof number, format, value);
  field_name(out, name);
  buffer_text(out, number);
}

void buffer_field_bytes(buffer *out, const char *name, const unsigned char *bytes, size_t length) {
  field_name(out, name);
  buffer_json_string(out, bytes, length);
}
