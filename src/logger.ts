import chalk from "chalk";

const ts = () => chalk.gray(new Date().toLocaleTimeString());

export const logger = {
  info: (msg: string) => console.log(`${ts()} ${chalk.cyan("ℹ")} ${msg}`),
  success: (msg: string) => console.log(`${ts()} ${chalk.green("✅")} ${msg}`),
  warn: (msg: string) => console.log(`${ts()} ${chalk.yellow("⚠")} ${msg}`),
  error: (msg: string) => console.log(`${ts()} ${chalk.red("❌")} ${msg}`),
  tool: (name: string, detail: string) =>
    console.log(`${ts()} ${chalk.magenta("🔧")} ${chalk.bold(name)} ${chalk.gray(detail)}`),
  msg: (openId: string, text: string) =>
    console.log(`${ts()} ${chalk.blue("💬")} ${chalk.gray(openId)} ${text.slice(0, 60)}${text.length > 60 ? "..." : ""}`),
  reply: (openId: string) =>
    console.log(`${ts()} ${chalk.green("↩")} replied to ${chalk.gray(openId)}`),
  dim: (msg: string) => console.log(`${ts()} ${chalk.gray(msg)}`),
};
