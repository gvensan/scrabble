// Starts, stops and restarts the local Worker and web dev servers.
// Usage: node scripts/dev.mjs <start|stop|restart|status> [--reset]
import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runDir = join(root, ".dev");
const workerState = join(root, "apps/worker/.wrangler/state");
const services = [
  {
    name: "worker",
    port: 8787,
    url: "http://127.0.0.1:8787/health",
    command: "npx",
    args: [
      "--yes",
      "wrangler@4.61.1",
      "dev",
      "--local",
      "--config",
      "apps/worker/wrangler.jsonc",
      "--port",
      "8787",
    ],
  },
  {
    name: "web",
    port: 5174,
    url: "http://127.0.0.1:5174/",
    command: "npm",
    args: ["run", "dev"],
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pidFile = (service) => join(runDir, `${service.name}.pid`);
const logFile = (service) => join(runDir, `${service.name}.log`);

async function healthy(service) {
  try {
    const response = await fetch(service.url, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function listeners(port) {
  try {
    return execFileSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

function savedPid(service) {
  try {
    return Number(readFileSync(pidFile(service), "utf8")) || null;
  } catch {
    return null;
  }
}

function signal(pid, name, group) {
  try {
    process.kill(group ? -pid : pid, name);
  } catch {
    // Already gone.
  }
}

async function stopService(service) {
  const pid = savedPid(service);
  // Each service runs in its own process group so npx/npm children stop too.
  if (pid) signal(pid, "SIGTERM", true);
  for (const other of listeners(service.port)) signal(other, "SIGTERM", false);
  for (let i = 0; i < 20 && listeners(service.port).length; i += 1)
    await sleep(250);
  for (const other of listeners(service.port)) signal(other, "SIGKILL", false);
  if (pid) signal(pid, "SIGKILL", true);
  rmSync(pidFile(service), { force: true });
  console.log(`stopped ${service.name}`);
}

async function startService(service) {
  if (await healthy(service)) {
    console.log(`${service.name} already running on port ${service.port}`);
    return true;
  }
  if (listeners(service.port).length) {
    console.error(
      `port ${service.port} is taken by another process; run "npm run stop" first`,
    );
    return false;
  }
  const log = openSync(logFile(service), "w");
  const child = spawn(service.command, service.args, {
    cwd: root,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  writeFileSync(pidFile(service), String(child.pid));
  for (let i = 0; i < 120; i += 1) {
    if (await healthy(service)) {
      console.log(
        `${service.name} ready at ${service.url.replace(/health$/, "")}`,
      );
      return true;
    }
    if (child.exitCode !== null) break;
    await sleep(500);
  }
  console.error(
    `${service.name} did not start; see ${relative(root, logFile(service))}:\n` +
      readFileSync(logFile(service), "utf8").split("\n").slice(-15).join("\n"),
  );
  return false;
}

function ensureLocalConfig() {
  for (const [example, target] of [
    [".env.example", ".env"],
    [".dev.vars.example", "apps/worker/.dev.vars"],
  ])
    if (!existsSync(join(root, target)) && existsSync(join(root, example))) {
      copyFileSync(join(root, example), join(root, target));
      console.log(`created ${target} from ${example}`);
    }
}

async function start(reset) {
  mkdirSync(runDir, { recursive: true });
  ensureLocalConfig();
  if (reset) {
    if (services.some((service) => listeners(service.port).length)) {
      console.error(
        '--reset needs the servers stopped; use "npm run restart -- --reset"',
      );
      return false;
    }
    rmSync(workerState, { recursive: true, force: true });
    console.log("cleared local rooms and rate limits");
  }
  for (const service of services)
    if (!(await startService(service))) return false;
  console.log(`logs: ${relative(root, runDir)}/*.log`);
  return true;
}

async function stop() {
  for (const service of [...services].reverse()) await stopService(service);
}

async function status() {
  for (const service of services) {
    const up = await healthy(service);
    const pids = listeners(service.port);
    console.log(
      `${service.name.padEnd(6)} ${up ? "running" : pids.length ? "not responding" : "stopped"}` +
        ` (port ${service.port}${pids.length ? `, pid ${pids.join(",")}` : ""})`,
    );
  }
}

const [command, ...flags] = process.argv.slice(2);
const reset = flags.includes("--reset");
let ok = true;
if (command === "start") ok = await start(reset);
else if (command === "stop") await stop();
else if (command === "restart") {
  await stop();
  ok = await start(reset);
} else if (command === "status") await status();
else {
  console.log(
    "usage: node scripts/dev.mjs <start|stop|restart|status> [--reset]",
  );
  ok = command === undefined;
}
process.exitCode = ok ? 0 : 1;
