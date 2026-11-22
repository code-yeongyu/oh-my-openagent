#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
extern int responsibility_spawnattrs_setdisclaim(posix_spawnattr_t *, int);
extern pid_t responsibility_get_pid_responsible_for_pid(pid_t);

static void check(int ok, const char *operation) {
    if (!ok) { perror(operation); exit(90); }
}

static void byte(int fd, char expected) {
    struct pollfd event = { .fd = fd, .events = POLLIN | POLLHUP };
    check(poll(&event, 1, 10000) > 0, "IPC deadline");
    char value = 0;
    check(read(fd, &value, 1) == 1 && value == expected, "IPC byte");
}

static int wait_child(pid_t pid) {
    int status;
    check(waitpid(pid, &status, 0) == pid && WIFEXITED(status), "child exit");
    return WEXITSTATUS(status);
}

static pid_t start(char *path, char **args, int disclaim, int input, int output) {
    posix_spawnattr_t attr;
    posix_spawn_file_actions_t files;
    check(posix_spawnattr_init(&attr) == 0, "spawnattr");
    check(posix_spawn_file_actions_init(&files) == 0, "spawn actions");
    if (disclaim) check(responsibility_spawnattrs_setdisclaim(&attr, 1) == 0, "disclaim");
    if (input >= 0) check(posix_spawn_file_actions_adddup2(&files, input, 0) == 0, "stdin");
    if (output >= 0) check(posix_spawn_file_actions_adddup2(&files, output, 1) == 0, "stdout");
    pid_t pid;
    int result = posix_spawn(&pid, path, &files, &attr, args, environ);
    posix_spawn_file_actions_destroy(&files);
    posix_spawnattr_destroy(&attr);
    check(result == 0, "posix_spawn");
    return pid;
}

static int engine(char *binary, int accepted) {
    int input[2], output[2];
    check(pipe(input) == 0 && pipe(output) == 0, "engine pipes");
    check(fcntl(input[0], F_SETFD, FD_CLOEXEC) == 0 &&
          fcntl(input[1], F_SETFD, FD_CLOEXEC) == 0 &&
          fcntl(output[0], F_SETFD, FD_CLOEXEC) == 0 &&
          fcntl(output[1], F_SETFD, FD_CLOEXEC) == 0, "pipe inheritance");
    char *args[] = {binary, "--stdio", NULL};
    pid_t child = start(binary, args, 0, input[0], output[1]);
    close(input[0]); close(output[1]);
    if (accepted) {
        const char request[] = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"engine.hello\",\"params\":{}}\n";
        check(write(input[1], request, sizeof(request) - 1) == sizeof(request) - 1, "hello");
        // Seeing the protocol reply proves the actual engine passed its native gate.
        byte(output[0], '{');
        char value = 0;
        while (value != '\n') {
            struct pollfd event = { .fd = output[0], .events = POLLIN };
            check(poll(&event, 1, 10000) > 0 && read(output[0], &value, 1) == 1, "hello reply");
        }
        check(responsibility_get_pid_responsible_for_pid(child) == getpid(), "engine responsibility");
    }
    close(input[1]);
    close(output[0]);
    int code = wait_child(child);
    check(code == (accepted ? 0 : 1), "engine gate result");
    return 0;
}

int main(int argc, char **argv) {
    check(argc >= 3, "arguments");
    alarm(15); // Bounded hang guard; IPC and exits, never time, order the test.
    signal(SIGPIPE, SIG_IGN);
    if (!strcmp(argv[1], "accepted-host")) {
        check(responsibility_get_pid_responsible_for_pid(getpid()) == getpid(), "self-responsible host");
        return engine(argv[2], 1);
    }
    if (!strcmp(argv[1], "orphan-host")) {
        int ready = atoi(argv[3]), go = atoi(argv[4]);
        check(responsibility_get_pid_responsible_for_pid(getpid()) != getpid(), "live launcher");
        check(write(ready, "R", 1) == 1, "ready");
        byte(go, 'G'); // The driver sends this only after waitpid confirms launcher exit.
        int code = engine(argv[2], 0);
        check(write(atoi(argv[5]), "D", 1) == 1, "engine completed");
        return code;
    }
    if (!strcmp(argv[1], "launcher")) {
        char *args[] = {argv[0], "orphan-host", argv[2], argv[3], argv[4], argv[6], NULL};
        start(argv[0], args, 0, -1, -1);
        byte(atoi(argv[5]), 'R');
        return 0;
    }
    if (!strcmp(argv[1], "valid")) {
        char *args[] = {argv[0], "accepted-host", argv[2], NULL};
        return wait_child(start(argv[0], args, 1, -1, -1));
    }
    check(!strcmp(argv[1], "loss"), "mode");
    int ready[2], go[2], done[2];
    check(pipe(ready) == 0 && pipe(go) == 0 && pipe(done) == 0, "launcher pipes");
    char ready_write[16], ready_read[16], go_read[16], done_write[16];
    snprintf(ready_write, sizeof ready_write, "%d", ready[1]);
    snprintf(ready_read, sizeof ready_read, "%d", ready[0]);
    snprintf(go_read, sizeof go_read, "%d", go[0]);
    snprintf(done_write, sizeof done_write, "%d", done[1]);
    char *args[] = {argv[0], "launcher", argv[2], ready_write, go_read, ready_read, done_write, NULL};
    pid_t launcher = start(argv[0], args, 1, -1, -1);
    check(wait_child(launcher) == 0, "launcher exited");
    check(write(go[1], "G", 1) == 1, "launch after exit");
    byte(done[0], 'D');
    return 0;
}
