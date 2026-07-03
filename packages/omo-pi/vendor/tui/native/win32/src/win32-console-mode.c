#include <windows.h>

#ifndef ENABLE_VIRTUAL_TERMINAL_INPUT
#define ENABLE_VIRTUAL_TERMINAL_INPUT 0x0200
#endif

#define NAPI_AUTO_LENGTH ((unsigned long long)-1)

typedef void* napi_env;
typedef void* napi_value;
typedef void* napi_callback_info;
typedef napi_value (__cdecl *napi_callback)(napi_env, napi_callback_info);
typedef int (__cdecl *napi_create_function_fn)(napi_env, const char*, unsigned long long, napi_callback, void*, napi_value*);
typedef int (__cdecl *napi_set_named_property_fn)(napi_env, napi_value, const char*, napi_value);
typedef int (__cdecl *napi_get_boolean_fn)(napi_env, int, napi_value*);

static void* node_symbol(const char* name) {
    HMODULE module = GetModuleHandleA(0);
    void* proc = module ? (void*)GetProcAddress(module, name) : 0;
    if (proc) return proc;

    module = GetModuleHandleA("node.dll");
    return module ? (void*)GetProcAddress(module, name) : 0;
}

static napi_value __cdecl enable_virtual_terminal_input(napi_env env, napi_callback_info info) {
    (void)info;

    HANDLE handle = GetStdHandle(STD_INPUT_HANDLE);
    DWORD mode = 0;
    int enabled = handle != INVALID_HANDLE_VALUE &&
        GetConsoleMode(handle, &mode) &&
        SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_INPUT);

    napi_get_boolean_fn napi_get_boolean = (napi_get_boolean_fn)node_symbol("napi_get_boolean");
    napi_value result = 0;
    if (napi_get_boolean) napi_get_boolean(env, enabled, &result);
    return result;
}

__declspec(dllexport) napi_value __cdecl napi_register_module_v1(napi_env env, napi_value exports) {
    napi_create_function_fn napi_create_function = (napi_create_function_fn)node_symbol("napi_create_function");
    napi_set_named_property_fn napi_set_named_property = (napi_set_named_property_fn)node_symbol("napi_set_named_property");

    napi_value fn = 0;
    if (napi_create_function &&
        napi_set_named_property &&
        napi_create_function(env, "enableVirtualTerminalInput", NAPI_AUTO_LENGTH, enable_virtual_terminal_input, 0, &fn) == 0) {
        napi_set_named_property(env, exports, "enableVirtualTerminalInput", fn);
    }

    return exports;
}
