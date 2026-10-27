// The host as an installed service: started by the operating system at
// login (and, on Linux with lingering, at boot), restarted if it fails, and
// independent of the desktop app or any terminal. What runs is the host's
// own `serve`, in the foreground, with idle shutdown off: the service
// manager supervises that process.
//
//   Linux    systemd --user unit   ~/.config/systemd/user/<name>.service
//            Restart=on-failure. Starts when the user's systemd starts: at
//            login, or at boot once `loginctl enable-linger` is set (status
//            says which).
//   macOS    LaunchAgent           ~/Library/LaunchAgents/<label>.plist
//            RunAtLoad, restarted when it exits unsuccessfully. Starts at
//            login (LaunchAgents run in the user's session).
//   Windows  Task Scheduler task   at logon of this user, hidden, restarted
//            on failure. Starts at login. The command runs through a small
//            script beside the host's files (`service.vbs`) so no console
//            window appears.
//
// The environment is captured when it is installed: PATH from the
// installing shell (so agent CLIs installed through nvm and the like are
// found), and any variable named with `--env` (written into the service
// definition, owner-readable only: name only what must be there). Its log
// goes to <home>/logs/service.log (Linux: also the journal).
//
// Uninstalling removes the service definition only; the host's data, its
// identity and its run records stay.
import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDaemonEnvironment } from "../daemon-environment.js";
import { acquireServiceOperation, writeServiceJson } from "./operation.js";

export const DEFAULT_SERVICE_NAME = "dream-host";

/** Which service runs the host of a home: `<home>/service.json`. */
const SERVICE_RECORD = "service.json";

export const readServiceRecord = (home) => {
  try {
    return JSON.parse(readFileSync(path.join(home, SERVICE_RECORD), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(
      "The service record is unreadable. Restore service.json before changing the service.",
    );
  }
};

/** The name of the service installed for `home`, or null. */
export const readInstalledServiceName = (home) => {
  try {
    const record = JSON.parse(
      readFileSync(path.join(home, SERVICE_RECORD), "utf8"),
    );
    return typeof record?.name === "string" ? record.name : null;
  } catch {
    return null;
  }
};

/** Task Scheduler's last-result codes worth naming. */
const TASK_RESULTS = {
  0: "succeeded",
  1: "exited with an error",
  267009: "running now",
  267011: "has not run yet",
  267014: "ended by request",
  2147750687: "already running",
};
const MAC_LABEL_PREFIX = "ai.dreamdream.";

/** Runs a command; resolves with { code, stdout, stderr } (never rejects). */
export const runCommand = (command, args, { timeoutMs = 30_000 } = {}) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve({
          code: error
            ? typeof error.code === "number"
              ? error.code
              : error.code === "ENOENT"
                ? null
                : 1
            : 0,
          stderr: String(stderr ?? error?.message ?? ""),
          stdout: String(stdout ?? ""),
        }),
    );
  });

export class ServiceError extends Error {
  constructor(message, detail = "") {
    super(message);
    this.name = "ServiceError";
    this.detail = detail;
  }
}

const lastLine = (text) =>
  String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";

const must = async (run, command, args, what) => {
  const result = await run(command, args);
  if (result.code !== 0) {
    throw new ServiceError(
      `${what} failed: ${lastLine(result.stderr) || lastLine(result.stdout) || `exit ${result.code}`}`,
      `${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
};

/**
 * What the service runs and with what environment.
 * @param {{
 *   program: string,
 *   entry: string,
 *   home: string,
 *   dataDirectory?: string | null,
 *   env: Record<string, string | undefined>,
 *   keepEnv?: string[],
 * }} options
 *   `program` / `entry`: the Node (or Electron-as-Node) that runs the host
 *   command line, and that command line's script.
 *   `keepEnv`: variables to capture besides PATH.
 */
export const describeService = ({
  program,
  entry,
  home,
  dataDirectory = null,
  env,
  keepEnv = [],
}) => {
  const clean = createDaemonEnvironment(env);
  const pathName =
    Object.keys(clean).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  const environment = {};
  if (clean[pathName]) environment[pathName] = clean[pathName];
  // Electron running as Node needs to keep doing so under the service.
  if (clean.ELECTRON_RUN_AS_NODE)
    environment.ELECTRON_RUN_AS_NODE = clean.ELECTRON_RUN_AS_NODE;
  for (const name of keepEnv) {
    if (typeof clean[name] === "string") environment[name] = clean[name];
  }
  if (
    environment.DREAM_DB_PATH &&
    !path.isAbsolute(environment.DREAM_DB_PATH)
  ) {
    throw new ServiceError(
      "DREAM_DB_PATH must be absolute when installing a service.",
    );
  }
  const args = [
    entry,
    "serve",
    "--home",
    home,
    "--data-dir",
    path.resolve(dataDirectory ?? path.join(home, "data")),
    "--idle-timeout",
    "0",
  ];
  return {
    args,
    environment,
    logPath: path.join(home, "logs", "service.log"),
    program,
  };
};

// ── Linux: systemd --user ────────────────────────────────────────────────

const systemdQuote = (value) =>
  /^[\w@%+=:,./-]+$/.test(value)
    ? value
    : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

export const systemdUnit = ({ definition }) =>
  [
    "[Unit]",
    "Description=Dream host",
    "Wants=network-online.target",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${[definition.program, ...definition.args].map(systemdQuote).join(" ")}`,
    ...Object.entries(definition.environment).map(
      ([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`,
    ),
    "Restart=on-failure",
    "RestartSec=5",
    // Stopping is a SIGTERM the host shuts down on (flushing its writes).
    "KillSignal=SIGTERM",
    "TimeoutStopSec=30",
    `StandardOutput=append:${definition.logPath}`,
    `StandardError=append:${definition.logPath}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");

const linuxAdapter = ({ name, run, homeDirectory, username }) => {
  const unit = `${name}.service`;
  const file = path.join(homeDirectory, ".config", "systemd", "user", unit);
  const systemctl = (args, what) =>
    must(run, "systemctl", ["--user", ...args], what);
  return {
    file,
    manager: "systemd --user",
    write: (definition) => systemdUnit({ definition }),
    async install() {
      await systemctl(["daemon-reload"], "Reloading systemd");
      await systemctl(["enable", "--now", unit], "Enabling the service");
    },
    async uninstall() {
      await run("systemctl", ["--user", "disable", "--now", unit]);
      rmSync(file, { force: true });
      await run("systemctl", ["--user", "daemon-reload"]);
    },
    start: () => systemctl(["start", unit], "Starting the service"),
    stop: () => systemctl(["stop", unit], "Stopping the service"),
    suspend: () =>
      systemctl(["stop", unit], "Stopping the service for replacement"),
    restart: () => systemctl(["restart", unit], "Restarting the service"),
    async status() {
      const shown = await run("systemctl", [
        "--user",
        "show",
        unit,
        "-p",
        "ActiveState,SubState,MainPID,ExecMainStatus,UnitFileState",
      ]);
      const fields = Object.fromEntries(
        shown.stdout
          .split(/\r?\n/)
          .map((line) => line.split("="))
          .filter((pair) => pair.length >= 2)
          .map(([key, ...rest]) => [key, rest.join("=")]),
      );
      const linger = await run("loginctl", [
        "show-user",
        username,
        "-p",
        "Linger",
      ]);
      return {
        enabled: fields.UnitFileState === "enabled",
        running: fields.ActiveState === "active",
        state: `${fields.ActiveState ?? "unknown"} (${fields.SubState ?? "?"})`,
        startsAt: /Linger=yes/.test(linger.stdout)
          ? "boot (lingering is on)"
          : "login (run `loginctl enable-linger` to start at boot)",
      };
    },
  };
};

// ── macOS: LaunchAgent ───────────────────────────────────────────────────

const xml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const launchAgentPlist = ({ label, definition }) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${xml(label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...[definition.program, ...definition.args].map(
      (arg) => `    <string>${xml(arg)}</string>`,
    ),
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    ...Object.entries(definition.environment).flatMap(([key, value]) => [
      `    <key>${xml(key)}</key>`,
      `    <string>${xml(value)}</string>`,
    ]),
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>ThrottleInterval</key>",
    "  <integer>10</integer>",
    "  <key>ProcessType</key>",
    "  <string>Interactive</string>",
    "  <key>StandardOutPath</key>",
    `  <string>${xml(definition.logPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xml(definition.logPath)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");

const macAdapter = ({ name, run, homeDirectory, uid }) => {
  const label = `${MAC_LABEL_PREFIX}${name}`;
  const file = path.join(
    homeDirectory,
    "Library",
    "LaunchAgents",
    `${label}.plist`,
  );
  const domain = `gui/${uid}`;
  const target = `${domain}/${label}`;
  return {
    file,
    manager: "launchd (LaunchAgent)",
    write: (definition) => launchAgentPlist({ definition, label }),
    async install() {
      // Replacing an earlier definition: out first, then in.
      await run("launchctl", ["bootout", target]);
      await must(
        run,
        "launchctl",
        ["bootstrap", domain, file],
        "Loading the LaunchAgent",
      );
    },
    async uninstall() {
      await run("launchctl", ["bootout", target]);
      rmSync(file, { force: true });
    },
    start: () =>
      must(run, "launchctl", ["kickstart", target], "Starting the service"),
    stop: () =>
      must(
        run,
        "launchctl",
        ["kill", "SIGTERM", target],
        "Stopping the service",
      ),
    suspend: async () => {
      const loaded = await run("launchctl", ["print", target]);
      if (loaded.code === 0)
        await must(
          run,
          "launchctl",
          ["bootout", target],
          "Unloading the service for replacement",
        );
    },
    restart: () =>
      must(
        run,
        "launchctl",
        ["kickstart", "-k", target],
        "Restarting the service",
      ),
    async status() {
      const printed = await run("launchctl", ["print", target]);
      if (printed.code !== 0) {
        return {
          enabled: false,
          running: false,
          state: "not loaded",
          startsAt: "login",
        };
      }
      const state =
        printed.stdout.match(/^\s*state = (.+)$/m)?.[1]?.trim() ?? "unknown";
      return {
        enabled: true,
        running: state === "running",
        state,
        startsAt: "login",
      };
    },
  };
};

// ── Windows: Task Scheduler ──────────────────────────────────────────────

const vbsString = (value) => `"${String(value).replaceAll('"', '""')}"`;
const cmdArg = (value) =>
  /[\s"&|<>^()]/.test(value)
    ? `"${String(value).replaceAll('"', '""')}"`
    : value;

/** The hidden launcher: sets the environment, runs the host, returns its exit code. */
export const windowsLauncher = (definition) => {
  const command = [definition.program, ...definition.args]
    .map(cmdArg)
    .join(" ");
  const line = `cmd /d /s /c "${command} >> ${cmdArg(definition.logPath)} 2>&1"`;
  return [
    "' The Dream host, started by Task Scheduler without a console window.",
    'Set shell = CreateObject("WScript.Shell")',
    'Set env = shell.Environment("Process")',
    ...Object.entries(definition.environment).map(
      ([key, value]) => `env(${vbsString(key)}) = ${vbsString(value)}`,
    ),
    `WScript.Quit shell.Run(${vbsString(line)}, 0, True)`,
    "",
  ].join("\r\n");
};

export const windowsTaskXml = ({ userId, launcherPath, description }) =>
  [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    `    <Description>${xml(description)}</Description>`,
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <LogonTrigger>",
    "      <Enabled>true</Enabled>",
    `      <UserId>${xml(userId)}</UserId>`,
    "    </LogonTrigger>",
    "  </Triggers>",
    "  <Principals>",
    '    <Principal id="Author">',
    `      <UserId>${xml(userId)}</UserId>`,
    "      <LogonType>InteractiveToken</LogonType>",
    "      <RunLevel>LeastPrivilege</RunLevel>",
    "    </Principal>",
    "  </Principals>",
    "  <Settings>",
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
    "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
    "    <AllowHardTerminate>true</AllowHardTerminate>",
    "    <StartWhenAvailable>true</StartWhenAvailable>",
    "    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>",
    "    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>",
    "    <AllowStartOnDemand>true</AllowStartOnDemand>",
    "    <Enabled>true</Enabled>",
    "    <Hidden>false</Hidden>",
    "    <RunOnlyIfIdle>false</RunOnlyIfIdle>",
    "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
    "    <Priority>7</Priority>",
    "    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>",
    "  </Settings>",
    '  <Actions Context="Author">',
    "    <Exec>",
    "      <Command>wscript.exe</Command>",
    `      <Arguments>//B //Nologo ${xml(cmdArg(launcherPath))}</Arguments>`,
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    "",
  ].join("\r\n");

const windowsAdapter = ({ name, run, home, userId }) => {
  const taskName =
    name === DEFAULT_SERVICE_NAME ? "Dream host" : `Dream host (${name})`;
  const launcherPath = path.join(home, "service.vbs");
  const xmlPath = path.join(home, "service-task.xml");
  return {
    file: launcherPath,
    manager: "Task Scheduler",
    taskName,
    write: (definition) => windowsLauncher(definition),
    async install() {
      // UTF-16 with a byte-order mark: what schtasks reads XML as.
      const xmlText = windowsTaskXml({
        description: `Runs the Dream host for ${userId} at logon.`,
        launcherPath,
        userId,
      });
      writeFileSync(xmlPath, `﻿${xmlText}`, { encoding: "utf16le" });
      try {
        await must(
          run,
          "schtasks",
          ["/Create", "/TN", taskName, "/XML", xmlPath, "/F"],
          "Creating the scheduled task",
        );
      } finally {
        rmSync(xmlPath, { force: true });
      }
      await must(
        run,
        "schtasks",
        ["/Run", "/TN", taskName],
        "Starting the scheduled task",
      );
    },
    async uninstall() {
      await run("schtasks", ["/End", "/TN", taskName]);
      await run("schtasks", ["/Delete", "/TN", taskName, "/F"]);
      rmSync(launcherPath, { force: true });
    },
    start: () =>
      must(
        run,
        "schtasks",
        ["/Run", "/TN", taskName],
        "Starting the scheduled task",
      ),
    // The host is stopped through its own record (it flushes its writes);
    // ending the task then stops the launcher.
    stop: () => run("schtasks", ["/End", "/TN", taskName]),
    suspend: async () => {
      await must(
        run,
        "schtasks",
        ["/Change", "/TN", taskName, "/Disable"],
        "Disabling service restarts",
      );
      await run("schtasks", ["/End", "/TN", taskName]);
    },
    restart: null,
    async status() {
      const queried = await run("schtasks", [
        "/Query",
        "/TN",
        taskName,
        "/FO",
        "LIST",
        "/V",
      ]);
      if (queried.code !== 0) {
        return {
          enabled: false,
          running: false,
          state: "not installed",
          startsAt: "login",
        };
      }
      const field = (label) =>
        queried.stdout
          .match(new RegExp(`^${label}:\\s*(.+)$`, "m"))?.[1]
          ?.trim() ?? null;
      const state = field("Status") ?? "unknown";
      const lastResult = field("Last Result");
      return {
        enabled: !/disabled/i.test(field("Scheduled Task State") ?? ""),
        lastResult:
          lastResult === null
            ? null
            : (TASK_RESULTS[Number(lastResult)] ?? `code ${lastResult}`),
        running: /running/i.test(state),
        state,
        startsAt: "login",
      };
    },
  };
};

/**
 * The service manager for this machine.
 * @param {{
 *   home: string,
 *   name?: string,
 *   platform?: NodeJS.Platform,
 *   run?: typeof runCommand,
 *   homeDirectory?: string,
 *   env?: Record<string, string | undefined>,
 *   uid?: number,
 *   username?: string,
 * }} options
 *   `home`: the host's home (its run records and logs live there).
 *   `name`: the service's name; a second name installs a second service
 *   (for another data directory, or for trying it out).
 */
export function createServiceManager({
  home,
  name = DEFAULT_SERVICE_NAME,
  platform = process.platform,
  run = runCommand,
  homeDirectory = os.homedir(),
  env = process.env,
  uid = typeof process.getuid === "function" ? process.getuid() : 0,
  username = os.userInfo().username,
}) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) {
    throw new ServiceError(
      "A service name is lowercase letters, digits and dashes.",
    );
  }
  const adapter =
    platform === "linux"
      ? linuxAdapter({ homeDirectory, name, run, username })
      : platform === "darwin"
        ? macAdapter({ homeDirectory, name, run, uid })
        : platform === "win32"
          ? windowsAdapter({
              home,
              name,
              run,
              userId: env.USERDOMAIN
                ? `${env.USERDOMAIN}\\${username}`
                : username,
            })
          : null;
  if (!adapter) {
    throw new ServiceError(
      `Installing the host as a service is not supported on ${platform}.`,
    );
  }

  return {
    adapter,

    /** Whether a service definition exists. */
    isInstalled: () => existsSync(adapter.file),

    /** Whether the installed definition runs the host of `hostHome`. */
    servesHome(hostHome) {
      const record = readServiceRecord(home);
      const launch = record?.launch;
      if (launch) {
        return (
          record.definition === adapter.file &&
          realpathSync(launch.args[launch.args.indexOf("--home") + 1]) ===
            realpathSync(hostHome)
        );
      }
      try {
        return readFileSync(adapter.file, "utf8").includes(hostHome);
      } catch {
        return false;
      }
    },

    /**
     * Writes the definition for `definition` (describeService) and has the
     * service manager start it now and at every login.
     */
    async install(definition) {
      mkdirSync(path.dirname(adapter.file), { recursive: true });
      mkdirSync(path.dirname(definition.logPath), { recursive: true });
      writeFileSync(adapter.file, adapter.write(definition), { mode: 0o600 });
      if (platform !== "win32") chmodSync(adapter.file, 0o600);
      writeServiceJson(path.join(home, SERVICE_RECORD), {
        definition: adapter.file,
        launch: definition,
        manager: adapter.manager,
        name,
      });
      await adapter.install();
      return adapter.file;
    },

    /** Removes the service definition. Data, identity and records stay. */
    async uninstall() {
      await adapter.uninstall();
      rmSync(path.join(home, SERVICE_RECORD), { force: true });
    },

    async start({ locked = false } = {}) {
      const release = locked ? null : acquireServiceOperation(home);
      try {
        if (existsSync(path.join(home, "service-update.json"))) {
          throw new ServiceError(
            "A service update needs recovery. Run `dream-host service recover` first.",
          );
        }
        return await adapter.start();
      } finally {
        release?.();
      }
    },
    stop: () => adapter.stop(),
    suspend: () => adapter.suspend(),
    /** null where restarting is stop then start (Windows). */
    restart: adapter.restart ? () => adapter.restart() : null,

    /**
     * The service manager's view: { installed, enabled, running, state,
     * startsAt, manager, definition, lastResult? }.
     */
    async status() {
      const installed = existsSync(adapter.file);
      const managed = installed
        ? await adapter.status()
        : {
            enabled: false,
            running: false,
            state: "not installed",
            startsAt: null,
          };
      return {
        ...managed,
        definition: adapter.file,
        installed,
        manager: adapter.manager,
      };
    },

    /** The last `lines` of the service's log, or null. */
    readLog(logPath, lines = 20) {
      try {
        return readFileSync(logPath, "utf8")
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(-lines)
          .join("\n");
      } catch {
        return null;
      }
    },
  };
}
