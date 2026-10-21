// `dream-host service ...`: the host as an installed service (service/).
//
//   service install [--data-dir dir] [--env NAME]... [--service-name name]
//   service start | stop | restart | uninstall
//   service status [--json]
//
// `install` records the Node running this command and this command's
// script, the host's home and data directory, PATH from this shell, and
// any variable named with --env; reinstalling replaces the definition.
// `status` puts the service manager's view beside the running host's
// (version, port, how it started) and the end of its log.
import { fileURLToPath } from "node:url";
import {
  createServiceManager,
  DEFAULT_SERVICE_NAME,
  describeService,
  readInstalledServiceName,
} from "./service/service.js";

const CLI_ENTRY = fileURLToPath(new URL("./dream-host.js", import.meta.url));
const WAIT_MS = 20_000;
const POLL_MS = 200;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{
 *   args: string[],
 *   values: Record<string, any>,
 *   home: string,
 *   env: Record<string, string | undefined>,
 *   probe: () => Promise<{ pid: number, port: number, version?: string, startedAt?: string } | null>,
 *   stopDaemon: () => Promise<boolean>,
 *   print: (line: string) => void,
 *   write: (value: unknown) => void,
 *   manager?: ReturnType<typeof createServiceManager>,
 * }} options
 *   `probe`: the running host for this home, verified (daemon.js).
 *   `stopDaemon`: stops it through its record.
 */
export async function runServiceCommand({
  args,
  values,
  home,
  env,
  probe,
  stopDaemon,
  print,
  write,
  manager = createServiceManager({
    env,
    home,
    // The one installed for this home, unless another is named.
    name:
      values["service-name"] ??
      readInstalledServiceName(home) ??
      DEFAULT_SERVICE_NAME,
  }),
}) {
  const action = args[0] ?? "status";
  const definition = describeService({
    dataDirectory: values["data-dir"] ?? null,
    entry: CLI_ENTRY,
    env,
    home,
    keepEnv: values.env ?? [],
    program: process.execPath,
  });

  const waitForHost = async (want) => {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const running = await probe();
      if (Boolean(running) === want) return running;
      await sleep(POLL_MS);
    }
    return want ? null : await probe();
  };

  const report = async () => {
    const service = await manager.status();
    const host = await probe();
    const summary = {
      ...service,
      host: host
        ? {
            pid: host.pid,
            port: host.port,
            startedAt: host.startedAt ?? null,
            version: host.version ?? null,
          }
        : null,
      log: definition.logPath,
    };
    if (values.json) {
      write(summary);
      return summary;
    }
    if (!service.installed) {
      print("The host is not installed as a service.");
    } else {
      print(
        `Service: ${service.state} (${service.manager}); starts at ${service.startsAt}.`,
      );
      print(`Definition: ${service.definition}`);
      if (service.lastResult) print(`Last result: ${service.lastResult}`);
    }
    print(
      host
        ? `Host: running, version ${host.version ?? "unknown"}, pid ${host.pid}, port ${host.port}, since ${host.startedAt ?? "unknown"}.`
        : "Host: not running.",
    );
    if (service.installed && !host) {
      const tail = manager.readLog(definition.logPath, 12);
      print(
        tail
          ? `Last log lines (${definition.logPath}):\n${tail}`
          : `No log yet at ${definition.logPath}.`,
      );
    }
    return summary;
  };

  switch (action) {
    case "status": {
      const summary = await report();
      return summary.installed && summary.host ? 0 : 3;
    }

    case "install": {
      // A host this home already runs (an `ensure` daemon) makes way: the
      // service's own takes over the same data.
      if (await probe()) {
        await stopDaemon();
        await waitForHost(false);
      }
      const file = await manager.install(definition);
      const host = await waitForHost(true);
      if (!values.json) {
        print(
          `Installed the host as a service (${manager.adapter.manager}): ${file}`,
        );
        print(
          `Environment captured: ${Object.keys(definition.environment).join(", ") || "none"}.`,
        );
      }
      await report();
      return host ? 0 : 1;
    }

    case "uninstall": {
      if (!manager.isInstalled()) {
        print("The host is not installed as a service.");
        return 0;
      }
      await manager.stop().catch(() => undefined);
      await stopDaemon();
      await manager.uninstall();
      print("Removed the service. The host's data and identity are kept.");
      return 0;
    }

    case "start": {
      if (!manager.isInstalled()) {
        print(
          "The host is not installed as a service. Run `dream-host service install` first.",
        );
        return 3;
      }
      await manager.start();
      const host = await waitForHost(true);
      print(
        host
          ? `Started (pid ${host.pid}, port ${host.port}).`
          : "The service did not bring the host up; see `dream-host service status`.",
      );
      return host ? 0 : 1;
    }

    case "stop": {
      // Ending the service first, so its manager does not restart what is
      // being stopped on purpose.
      await manager.stop().catch(() => undefined);
      await stopDaemon();
      const stillRunning = await waitForHost(false);
      print(stillRunning ? "The host is still running." : "Stopped.");
      return stillRunning ? 1 : 0;
    }

    case "restart": {
      if (!manager.isInstalled()) {
        print("The host is not installed as a service.");
        return 3;
      }
      const before = await probe();
      if (manager.restart) {
        await manager.restart();
      } else {
        await manager.stop().catch(() => undefined);
        await stopDaemon();
        await waitForHost(false);
        await manager.start();
      }
      // A restart interrupts running turns; they resume as their queue's
      // recovery rules say (an interrupted run waits for an explicit resume).
      const deadline = Date.now() + WAIT_MS;
      let after = null;
      while (Date.now() < deadline) {
        after = await probe();
        if (after && after.pid !== before?.pid) break;
        await sleep(POLL_MS);
      }
      const restarted = after && after.pid !== before?.pid;
      print(
        restarted
          ? `Restarted (pid ${after.pid}, port ${after.port}). Turns that were running are marked interrupted; review them and retry from their chats.`
          : "The host did not come back; see `dream-host service status`.",
      );
      return restarted ? 0 : 1;
    }

    default:
      print(
        "Usage: dream-host service <install|start|stop|restart|status|uninstall> [--data-dir dir] [--env NAME]... [--service-name name] [--json]",
      );
      return 2;
  }
}
