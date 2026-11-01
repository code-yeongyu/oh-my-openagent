import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeviceRef, LocalRequest, Status } from "../../../src/local-api/protocol.ts";
import { assertNever } from "../../../src/local-api/validate-fields.ts";
import { sessionHandler } from "./fake-owner-sessions.ts";
import {
  type Conn,
  eventOf,
  ok,
  type Outcome,
  type OwnerState,
  refuse,
} from "./fake-owner-state.ts";

const setStatus = (state: OwnerState, status: Status): void => {
  state.status = status;
  for (const conn of state.conns)
    if (conn.subscribed) conn.send(eventOf("status.changed", { status }));
};

const deviceStatus = (state: OwnerState, device: DeviceRef | null): Status => ({
  ...state.status,
  device,
  state: device === null ? "signed_out" : state.world.status.state,
  since_ms: state.now(),
});

export const dispatch = (state: OwnerState, conn: Conn, request: LocalRequest): Outcome => {
  state.log.push(request.type);
  const role = conn.client()?.name;
  switch (request.type) {
    case "authenticate":
      return refuse("invalid_request", "already authenticated");
    case "status.get":
      return ok(state.status);
    case "status.subscribe":
      conn.subscribed = true;
      return ok({}, () => conn.send(eventOf("status.changed", { status: state.status })));
    case "service.set_enabled": {
      writeFileSync(
        join(state.stateDir, "config.json"),
        JSON.stringify({ enabled: request.enabled }),
      );
      const next: Status = {
        ...state.status,
        enabled: request.enabled,
        state: request.enabled ? state.world.status.state : "disabled",
        since_ms: state.now(),
      };
      return ok({ enabled: request.enabled }, () => setStatus(state, next));
    }
    case "refresher.register":
      state.refresher = { binary_path: request.binary_path, version: request.version };
      return ok();
    case "device.adopt":
      state.adoptions += 1;
      return ok({ device: request.device }, () =>
        setStatus(state, deviceStatus(state, request.device)),
      );
    case "device.forget":
      return ok({}, () => setStatus(state, deviceStatus(state, null)));
    case "device.info":
      return ok({ device: state.status.device });
    case "endpoints.register":
      state.endpoints.add(request.agent_dir);
      return ok();
    case "endpoints.unregister":
      state.endpoints.delete(request.agent_dir);
      return ok();
    case "devices.list":
      return ok({ devices: state.world.devices });
    case "enforcement.report": {
      if (role !== "desktop")
        return refuse("forbidden", "only a desktop client reports enforcement");
      if (request.data_home !== conn.client()?.data_home)
        return refuse("forbidden", "a report names the home of its own connection");
      const { id: _id, type: _type, ...report } = request;
      state.reports.push(report);
      return ok();
    }
    case "owner.shutdown_for_upgrade":
      if (role !== "installer") return refuse("forbidden", "only the installer stops the owner");
      return ok({}, () => void state.stop());
    case "sessions.list":
    case "session.attach":
    case "session.detach":
    case "session.command":
    case "session.command_part":
    case "session.read":
      return sessionHandler(state, conn, request);
    default:
      return assertNever(request);
  }
};
