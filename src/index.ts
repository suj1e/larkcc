#!/usr/bin/env node
import { program } from "commander";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";
import { loadConfig, globalConfigExists, GLOBAL_CONFIG_PATH, listProfiles } from "./config.js";
import { runSetup, runNewProfile } from "./setup.js";
import { startApp, listRunningProcesses } from "./app.js";
import { logger } from "./logger.js";
import { clearSession, initSession } from "./session.js";

function printBanner(version: string) {
  console.log(chalk.cyan(`
  ██╗      █████╗ ██████╗ ██╗  ██╗ ██████╗ ██████╗
  ██║     ██╔══██╗██╔══██╗██║ ██╔╝██╔════╝██╔════╝
  ██║     ███████║██████╔╝█████╔╝ ██║     ██║
  ██║     ██╔══██║██╔══██╗██╔═██╗ ██║     ██║
  ███████╗██║  ██║██║  ██║██║  ██╗╚██████╗╚██████╗
  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝
  `));
  console.log(chalk.gray(`  Claude Code in Feishu  v${version}\n`));
}

program
  .name("larkcc")
  .description("Claude Code in Feishu — chat with Claude via Lark bot")
  .version("0.1.0")
  .option("-d, --daemon",           "run as background process")
  .option("-c, --continue",         "resume last Claude session")
  .option("-p, --profile <name>",   "use a specific Feishu bot profile")
  .option("--setup",                "reconfigure current profile")
  .option("--new-profile",          "add a new Feishu bot profile")
  .option("--list-profiles",        "list all configured profiles")
  .option("--reset-session",        "clear saved Claude session")
  .option("--ps",                   "list running larkcc processes")
  .option("--cleanup-tmp-files",    "clean up temporary files")
  .option("--older-than <hours>",   "only clean files older than N hours", "0")
  .option("--all",                  "clean temp files for all profiles")
  .parse(process.argv);

const opts = program.opts();
const cwd  = process.cwd();
const profile: string | undefined = opts.profile;

// daemon 模式
if (opts.daemon) {
  const { spawn } = await import("child_process");
  const args = process.argv.slice(1).filter(a => !["-d", "--daemon"].includes(a));
  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
  child.unref();
  logger.success(`larkcc started in background (pid: ${child.pid})`);
  process.exit(0);
}

// list profiles
if (opts.listProfiles) {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    logger.warn("No profiles configured. Run: larkcc --setup");
  } else {
    console.log("\nAvailable profiles:");
    for (const p of profiles) {
      const tag = p.name === "default" ? chalk.gray("(default)") : "";
      console.log(`  ${chalk.cyan(p.name.padEnd(16))} ${chalk.gray(p.app_id)} ${tag}`);
    }
    console.log();
  }
  process.exit(0);
}

// list running processes
if (opts.ps) {
  const { processes, cleaned } = listRunningProcesses();

  if (cleaned.length > 0) {
    for (const profile of cleaned) {
      console.log(chalk.yellow(`Cleaned stale lock: ${profile} (process already dead)`));
    }
    console.log();
  }

  if (processes.length === 0) {
    console.log(chalk.gray("No running larkcc processes."));
  } else {
    console.log("\nRunning larkcc processes:\n");
    console.log("  Profile          PID      Directory                         Started              Mode");
    console.log("  " + "─".repeat(90));

    for (const p of processes) {
      const profile = p.profile.padEnd(16);
      const pid = String(p.pid).padEnd(8);
      const cwd = p.cwd.length > 32 ? "…" + p.cwd.slice(-31) : p.cwd.padEnd(32);
      const started = new Date(p.startedAt).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).replace(/\//g, "-").padEnd(12);
      const mode = p.isContinue ? chalk.cyan("continue") : "new      ";
      console.log(`  ${chalk.cyan(profile)}  ${pid}  ${chalk.gray(cwd)}  ${started}  ${mode}`);
    }
    console.log();
  }
  process.exit(0);
}

// cleanup temp files
if (opts.cleanupTmpFiles) {
  const baseTempDir = path.join(os.homedir(), ".larkcc", "temp");
  const olderThanHours = parseFloat(opts.olderThan) || 0;
  const olderThanMs = olderThanHours * 60 * 60 * 1000;
  const cutoffTime = Date.now() - olderThanMs;

  let deletedCount = 0;
  let deletedSize = 0;
  let errorCount = 0;

  const profilesToClean: string[] = [];

  if (opts.all) {
    // 清理所有 profile
    if (fs.existsSync(baseTempDir)) {
      const dirs = fs.readdirSync(baseTempDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (dir.isDirectory()) {
          profilesToClean.push(dir.name);
        }
      }
    }
  } else {
    // 只清理当前 profile
    profilesToClean.push(profile ?? "default");
  }

  console.log(chalk.cyan(`\nCleaning temporary files...`));
  if (olderThanHours > 0) {
    console.log(chalk.gray(`  Filter: older than ${olderThanHours} hours`));
  }
  console.log(chalk.gray(`  Profiles: ${profilesToClean.join(", ")}\n`));

  for (const profileName of profilesToClean) {
    const tempDir = path.join(baseTempDir, profileName);
    if (!fs.existsSync(tempDir)) {
      console.log(chalk.gray(`  ${profileName}: (no temp directory)`));
      continue;
    }

    let profileDeleted = 0;
    let profileSize = 0;

    const files = fs.readdirSync(tempDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) continue;

      const filePath = path.join(tempDir, file.name);
      try {
        const stat = fs.statSync(filePath);
        if (olderThanMs > 0 && stat.mtimeMs > cutoffTime) {
          continue; // 文件不够旧，跳过
        }
        const size = stat.size;
        fs.unlinkSync(filePath);
        profileDeleted++;
        profileSize += size;
      } catch (e) {
        errorCount++;
        console.log(chalk.yellow(`  Failed to delete: ${file.name}`));
      }
    }

    deletedCount += profileDeleted;
    deletedSize += profileSize;

    const sizeKB = Math.round(profileSize / 1024);
    console.log(`  ${chalk.cyan(profileName)}: ${profileDeleted} files, ${sizeKB}KB`);
  }

  console.log();
  const totalSizeMB = (deletedSize / 1024 / 1024).toFixed(2);
  if (deletedCount > 0) {
    console.log(chalk.green(`✅ Cleaned ${deletedCount} files (${totalSizeMB}MB)`));
  } else {
    console.log(chalk.gray("No files to clean"));
  }
  if (errorCount > 0) {
    console.log(chalk.yellow(`⚠️  ${errorCount} files failed to delete`));
  }
  console.log();
  process.exit(0);
}

// new profile
if (opts.newProfile) {
  await runNewProfile();
  process.exit(0);
}

// reset session
if (opts.resetSession) {
  initSession(profile);
  clearSession();
  logger.success(`Session cleared${profile ? ` for profile "${profile}"` : ""}`);
  process.exit(0);
}

printBanner("0.1.0");

// setup
if (opts.setup) {
  await runSetup(profile);
}

// 首次运行引导配置
let config;
if (!globalConfigExists()) {
  logger.warn("No config found, running setup...\n");
  await runSetup(undefined);
}

try {
  config = loadConfig(cwd, profile);
} catch (err) {
  logger.error(String(err));
  logger.info(`Edit your config: ${GLOBAL_CONFIG_PATH}`);
  if (profile) logger.info(`Or add this profile: larkcc --setup -p ${profile}`);
  process.exit(1);
}

// 初始化 session（按 profile 隔离）
initSession(profile);

await startApp(cwd, config, profile, opts.continue ?? false);