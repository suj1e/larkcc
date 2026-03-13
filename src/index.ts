#!/usr/bin/env node
import { program } from "commander";
import chalk from "chalk";
import { loadConfig, globalConfigExists, GLOBAL_CONFIG_PATH } from "./config.js";
import { runSetup } from "./setup.js";
import { startApp } from "./app.js";
import { logger } from "./logger.js";
import { clearSession } from "./session.js";

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
  .option("-d, --daemon",          "run as background process")
  .option("-c, --continue",        "resume last Claude session")
  .option("--setup",               "reconfigure ~/.larkcc/config.yml")
  .option("--reset-session",       "clear saved Claude session")
  .parse(process.argv);

const opts = program.opts();
const cwd  = process.cwd();

// daemon 模式
if (opts.daemon) {
  const { spawn } = await import("child_process");
  const args = process.argv.slice(1).filter(a => !["-d", "--daemon"].includes(a));
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  logger.success(`larkcc started in background (pid: ${child.pid})`);
  logger.dim(`Logs: ${cwd}/.larkcc.log`);
  process.exit(0);
}

// reset session
if (opts.resetSession) {
  clearSession();
  logger.success("Session cleared");
  process.exit(0);
}

printBanner("0.1.0");

// setup
if (opts.setup) {
  await runSetup();
}

// 首次运行引导配置
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

await startApp(cwd, config, opts.continue ?? false);
