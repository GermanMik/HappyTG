import path from "node:path";

import {
  ensureDir,
  fileExists,
  getLocalStateDir,
  resolveHome,
  resolveExecutable,
  writeTextFileAtomic
} from "../../../shared/src/index.js";

import { runCommand } from "./commands.js";
import type { BackgroundMode, BackgroundSetupResult } from "./types.js";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function writeLauncherScript(input: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<string> {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const stateDir = getLocalStateDir(env, platform);
  const binDir = path.join(stateDir, "bin");
  await ensureDir(binDir);

  if (platform === "win32") {
    const launcherPath = path.join(binDir, "happytg-daemon-launch.cmd");
    const content = [
      "@echo off",
      `cd /d "${input.repoRoot}"`,
      "pnpm dev:daemon"
    ].join("\r\n");
    await writeTextFileAtomic(launcherPath, `${content}\r\n`);
    return launcherPath;
  }

  const launcherPath = path.join(binDir, "happytg-daemon-launch.sh");
  const content = [
    "#!/bin/sh",
    `cd ${shellQuote(input.repoRoot)}`,
    "exec pnpm dev:daemon"
  ].join("\n");
  await writeTextFileAtomic(launcherPath, `${content}\n`);
  return launcherPath;
}

async function configureLaunchAgent(input: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<BackgroundSetupResult> {
  const launcherPath = await writeLauncherScript(input);
  const plistPath = resolveHome("~/Library/LaunchAgents/dev.happytg.host-daemon.plist", {
    env: input.env,
    platform: input.platform
  });
  const stateDir = getLocalStateDir(input.env, input.platform);
  const label = "dev.happytg.host-daemon";
  const plist = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    `  <string>${label}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${launcherPath}</string>`,
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>WorkingDirectory</key>",
    `  <string>${input.repoRoot}</string>`,
    "  <key>StandardOutPath</key>",
    `  <string>${path.join(stateDir, "logs", "host-daemon.out.log")}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${path.join(stateDir, "logs", "host-daemon.err.log")}</string>`,
    "</dict>",
    "</plist>"
  ].join("\n");
  await ensureDir(path.dirname(plistPath));
  await ensureDir(path.join(stateDir, "logs"));
  await writeTextFileAtomic(plistPath, `${plist}\n`);

  const launchctl = await resolveExecutable("launchctl", {
    env: input.env,
    platform: input.platform
  });
  if (launchctl) {
    await runCommand({
      command: launchctl,
      args: ["bootout", `gui/${process.getuid?.() ?? 0}`, plistPath],
      env: input.env,
      platform: input.platform
    }).catch(() => undefined);
    await runCommand({
      command: launchctl,
      args: ["bootstrap", `gui/${process.getuid?.() ?? 0}`, plistPath],
      env: input.env,
      platform: input.platform
    }).catch(() => undefined);
  }

  return {
    mode: "launchagent",
    status: "configured",
    detail: `LaunchAgent configured at ${plistPath}.`,
    artifactPath: plistPath,
    launcherPath
  };
}

async function configureScheduledTask(input: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<BackgroundSetupResult> {
  const launcherPath = await writeLauncherScript(input);
  const schtasks = await resolveExecutable("schtasks", {
    env: input.env,
    platform: input.platform
  });
  if (!schtasks) {
    return {
      mode: "scheduled-task",
      status: "manual",
      detail: "schtasks.exe was not found. Create a logon task manually after install.",
      launcherPath
    };
  }

  await runCommand({
    command: schtasks,
    args: ["/Create", "/F", "/SC", "ONLOGON", "/TN", "HappyTG Host Daemon", "/TR", launcherPath],
    env: input.env,
    platform: input.platform
  }).catch(() => undefined);

  return {
    mode: "scheduled-task",
    status: "configured",
    detail: "Scheduled Task configured for HappyTG Host Daemon.",
    launcherPath
  };
}

async function configureStartupShortcut(input: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<BackgroundSetupResult> {
  const launcherPath = await writeLauncherScript(input);
  const startupDir = resolveHome("~/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup", {
    env: input.env,
    platform: input.platform
  });
  const shortcutPath = path.join(startupDir, "HappyTG Host Daemon.cmd");
  await ensureDir(startupDir);
  const launcherExists = await fileExists(launcherPath);
  if (!launcherExists) {
    return {
      mode: "startup",
      status: "failed",
      detail: "Startup launcher could not be created.",
      launcherPath
    };
  }

  await writeTextFileAtomic(shortcutPath, `@echo off\r\ncall "${launcherPath}"\r\n`);
  return {
    mode: "startup",
    status: "configured",
    detail: `Startup shortcut created at ${shortcutPath}.`,
    artifactPath: shortcutPath,
    launcherPath
  };
}

async function configureSystemdUser(input: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<BackgroundSetupResult> {
  const launcherPath = await writeLauncherScript(input);
  const unitPath = resolveHome("~/.config/systemd/user/happytg-host-daemon.service", {
    env: input.env,
    platform: input.platform
  });
  const unit = [
    "[Unit]",
    "Description=HappyTG Host Daemon",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${input.repoRoot}`,
    `ExecStart=${launcherPath}`,
    "Restart=always",
    "",
    "[Install]",
    "WantedBy=default.target"
  ].join("\n");

  await ensureDir(path.dirname(unitPath));
  await writeTextFileAtomic(unitPath, `${unit}\n`);
  const systemctl = await resolveExecutable("systemctl", {
    env: input.env,
    platform: input.platform
  });
  if (systemctl) {
    await runCommand({
      command: systemctl,
      args: ["--user", "daemon-reload"],
      env: input.env,
      platform: input.platform
    }).catch(() => undefined);
    await runCommand({
      command: systemctl,
      args: ["--user", "enable", "--now", "happytg-host-daemon.service"],
      env: input.env,
      platform: input.platform
    }).catch(() => undefined);
  }

  return {
    mode: "systemd-user",
    status: "configured",
    detail: `systemd user service written to ${unitPath}.`,
    artifactPath: unitPath,
    launcherPath
  };
}

export async function configureBackgroundMode(input: {
  mode: BackgroundMode;
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<BackgroundSetupResult> {
  switch (input.mode) {
    case "launchagent":
      return configureLaunchAgent(input);
    case "scheduled-task":
      return configureScheduledTask(input);
    case "startup":
      return configureStartupShortcut(input);
    case "systemd-user":
      return configureSystemdUser(input);
    case "manual":
      return {
        mode: "manual",
        status: "manual",
        detail: "Start the daemon manually with `pnpm dev:daemon` after pairing."
      };
    case "skip":
    default:
      return {
        mode: "skip",
        status: "skipped",
        detail: "Background daemon setup was skipped."
      };
  }
}
