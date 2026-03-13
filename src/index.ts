#!/usr/bin/env node
import "process";
import { program } from "commander";
import chalk from "chalk";
import { loadConfig, globalConfigExists, GLOBAL_CONFIG_PATH } from "./config.js";
import { runSetup } from "./setup.js";
import { startApp } from "./app.js";
import { logger } from "./logger.js";
import { clearSession } from "./session.js";
import { createReadStream } from "fs";

// ── banner ────────────────────────────────────────────────────
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

// ── CLI ───────────────────────────────────────────────────────
program
  .name("larkcc")
  .description("Claude Code in Feishu — chat with Claude via Lark bot")
  .version("0.1.0")
  .option("-d, --daemon", "run as background process (nohup)")
  .option("--setup", "reconfigure ~/.larkcc/config.yml")
  .option("--reset-session", "clear current Claude session")
  .option("--whoami", "print your Feishu open_id (send any msg to bot first)")
  .parse(process.argv);

const opts = program.opts();
const cwd  = process.cwd();

// ── daemon 模式 ───────────────────────────────────────────────
if (opts.daemon) {
  const { spawn } = await import("child_process");
  const logFile = `${cwd}/.larkcc.log`;
  const child = spawn(process.execPath, process.argv.slice(1).filter(a => a !== "-d" && a !== "--daemon"), {
    detached: true,
    stdio: ["ignore", createReadStream(logFile) as any, createReadStream(logFile) as any],
  });
  child.unref();
  logger.success(`larkcc started in background (pid: ${child.pid})`);
  logger.dim(`Logs: ${logFile}`);
  process.exit(0);
}

// ── reset session ─────────────────────────────────────────────
if (opts.resetSession) {
  clearSession();
  logger.success("Session cleared");
  process.exit(0);
}

// ── main ──────────────────────────────────────────────────────
printBanner("0.1.0");

// setup 强制重新配置
if (opts.setup) {
  await runSetup();
}

// 首次运行，引导配置
let config;
if (!globalConfigExists()) {
  logger.warn("No config found, running setup...\n");
  config = await runSetup();
} else {
  try {
    config = loadConfig(cwd);
  } catch (err) {
    logger.error(String(err));
    logger.info(`Edit your config: ${GLOBAL_CONFIG_PATH}`);
    process.exit(1);
  }
}

await startApp(cwd, config);
