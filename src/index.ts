#!/usr/bin/env node
import { program } from "commander";
import chalk from "chalk";
import { loadConfig, globalConfigExists, GLOBAL_CONFIG_PATH, listProfiles } from "./config.js";
import { runSetup, runNewProfile } from "./setup.js";
import { startApp } from "./app.js";
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