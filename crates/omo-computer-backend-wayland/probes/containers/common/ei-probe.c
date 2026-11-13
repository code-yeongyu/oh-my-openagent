/* SP-W libei probe helper. Built inside the GNOME and KDE probe images; it is the "engine" end of an
 * EIS socket the portal handed out. Usage: ei-probe <regions|hold-shift> <fd> <seconds>
 *   regions     print every device with its capabilities and regions, then exit after <seconds>
 *   hold-shift  as regions, and press KEY_LEFTSHIFT on the first resumed keyboard and print {"held":true};
 *               it never releases the key: the caller SIGKILLs this process.
 *   type-a      as regions, and press and release KEY_A once on the first resumed keyboard (the second injector).
 *   armed-a     as type-a, but prints {"armed":true} when its keyboard resumed and types only after SIGUSR1.
 * One JSON object per line on stdout. */
#include <libei.h>
#include <linux/input-event-codes.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static volatile sig_atomic_t fire = 0;
static void on_usr1(int s) { (void)s; fire = 1; }

static void type_a_now(struct ei *ei, struct ei_device *d, uint32_t *seq) {
  ei_device_start_emulating(d, (*seq)++);
  ei_device_keyboard_key(d, KEY_A, true);
  ei_device_frame(d, ei_now(ei));
  ei_device_keyboard_key(d, KEY_A, false);
  ei_device_frame(d, ei_now(ei));
  ei_device_stop_emulating(d);
  printf("{\"typed\":\"a\",\"device\":\"%s\"}\n", ei_device_get_name(d));
  fflush(stdout);
}

static double now_s(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }

int main(int argc, char **argv) {
  if (argc != 4) { fprintf(stderr, "usage: ei-probe <regions|hold-shift> <fd> <seconds>\n"); return 2; }
  int hold = strcmp(argv[1], "hold-shift") == 0, type_a = strcmp(argv[1], "type-a") == 0;
  int armed = strcmp(argv[1], "armed-a") == 0;
  struct ei_device *armed_dev = NULL;
  signal(SIGUSR1, on_usr1);
  int fd = atoi(argv[2]);
  double until = now_s() + atof(argv[3]);
  struct ei *ei = ei_new_sender(NULL);
  ei_configure_name(ei, "spw-probe");
  if (ei_setup_backend_fd(ei, fd) != 0) { printf("{\"error\":\"setup_backend_fd\"}\n"); return 1; }
  struct pollfd p = { .fd = ei_get_fd(ei), .events = POLLIN };
  uint32_t seq = 1; int held = 0;
  while (now_s() < until) {
    if (fire && armed_dev) { type_a_now(ei, armed_dev, &seq); fire = 0; armed_dev = NULL; }
    if (poll(&p, 1, 20) < 0 && !fire) break;
    ei_dispatch(ei);
    struct ei_event *e;
    while ((e = ei_get_event(ei))) {
      switch (ei_event_get_type(e)) {
      case EI_EVENT_CONNECT: printf("{\"event\":\"connect\"}\n"); break;
      case EI_EVENT_DISCONNECT: printf("{\"event\":\"disconnect\"}\n"); fflush(stdout); return 3;
      case EI_EVENT_SEAT_ADDED:
        ei_seat_bind_capabilities(ei_event_get_seat(e), EI_DEVICE_CAP_POINTER, EI_DEVICE_CAP_POINTER_ABSOLUTE,
                                  EI_DEVICE_CAP_KEYBOARD, EI_DEVICE_CAP_BUTTON, EI_DEVICE_CAP_SCROLL, NULL);
        break;
      case EI_EVENT_DEVICE_ADDED: {
        struct ei_device *d = ei_event_get_device(e);
        printf("{\"event\":\"device\",\"name\":\"%s\",\"abs\":%d,\"rel\":%d,\"kbd\":%d,\"regions\":[",
               ei_device_get_name(d), ei_device_has_capability(d, EI_DEVICE_CAP_POINTER_ABSOLUTE),
               ei_device_has_capability(d, EI_DEVICE_CAP_POINTER), ei_device_has_capability(d, EI_DEVICE_CAP_KEYBOARD));
        struct ei_region *r; size_t i = 0;
        while ((r = ei_device_get_region(d, i))) {
          printf("%s{\"x\":%u,\"y\":%u,\"w\":%u,\"h\":%u,\"scale\":%.2f}", i ? "," : "", ei_region_get_x(r),
                 ei_region_get_y(r), ei_region_get_width(r), ei_region_get_height(r), ei_region_get_physical_scale(r));
          i++;
        }
        printf("]}\n");
        break;
      }
      case EI_EVENT_DEVICE_RESUMED: {
        struct ei_device *d = ei_event_get_device(e);
        if (hold && !held && ei_device_has_capability(d, EI_DEVICE_CAP_KEYBOARD)) {
          ei_device_start_emulating(d, seq++);
          ei_device_keyboard_key(d, KEY_LEFTSHIFT, true);
          ei_device_frame(d, ei_now(ei));
          held = 1;
          printf("{\"held\":true,\"device\":\"%s\"}\n", ei_device_get_name(d));
        } else if (type_a && !held && ei_device_has_capability(d, EI_DEVICE_CAP_KEYBOARD)) {
          type_a_now(ei, d, &seq);
          held = 1;
        } else if (armed && !armed_dev && !held && ei_device_has_capability(d, EI_DEVICE_CAP_KEYBOARD)) {
          armed_dev = d;
          held = 1;
          printf("{\"armed\":true,\"device\":\"%s\"}\n", ei_device_get_name(d));
        }
        break;
      }
      default: break;
      }
      ei_event_unref(e);
      fflush(stdout);
    }
  }
  printf("{\"event\":\"timeout\",\"held\":%d}\n", held);
  return 0;
}
