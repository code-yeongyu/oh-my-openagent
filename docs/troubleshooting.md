# Troubleshooting & Known Issues

## Port 8000 Conflict / "Not Found" Error

**Date:** 2026-01-29
**Status:** Resolved

### Issue
When starting the FastAPI server with `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`, the server appeared to start successfully, but accessing `http://localhost:8000/dashboard` resulted in a `404 Not Found` error. Accessing the root `/` returned `{"Hello": "World"}`, which did not match the current codebase (which has no root route).

### Investigation
1.  **Code Verification**: Verified `app/main.py` contained the `/dashboard` route.
2.  **Process Check**: ran `lsof -i :8000` and found multiple processes.
    - `Code Helper (Plugin)` (VS Code) was listening on port 8000.
    - A stale `Python` process was also seen intermittently.
3.  **Root Cause**: A stale or external process was already bound to port 8000. `uvicorn` either failed to bind (but didn't crash explicitly) or we were connecting to the pre-existing process (likely the "Hello World" app from a previous session or a default VS Code service) instead of our new instance.

### Resolution
1.  **Workaround**: Switched the server port to **8009**.
    ```bash
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8009
    ```
2.  **Verification**: Validated access via `curl http://localhost:8009/dashboard` which returned the correct HTML.

### Prevention / Fix Flow
If this happens again:
1.  Check for existing processes on the port: `lsof -i :<port>`
2.  Kill rogue processes: `kill -9 <PID>`
3.  Or simply use a different, free port (e.g., 8001, 8009).
