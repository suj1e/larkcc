import readline from "readline";
import { saveGlobalConfig, LarkccConfig } from "./config.js";
import { logger } from "./logger.js";

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function runSetup(): Promise<LarkccConfig> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n🛠  larkcc setup — configure your Feishu bot\n");

  const app_id      = await prompt(rl, "  Feishu App ID     : ");
  const app_secret  = await prompt(rl, "  Feishu App Secret : ");
  const owner_open_id = await prompt(rl, "  Your Open ID      : ");

  rl.close();

  const config: LarkccConfig = {
    feishu: { app_id, app_secret, owner_open_id },
    claude: {
      permission_mode: "acceptEdits",
      allowed_tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "LS"],
    },
  };

  saveGlobalConfig(config);
  logger.success("Config saved to ~/.larkcc/config.yml\n");

  return config;
}
