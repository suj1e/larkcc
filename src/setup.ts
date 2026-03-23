import readline from "readline";
import { saveProfile, GLOBAL_CONFIG_PATH, FileConfig } from "./config.js";
import { logger } from "./logger.js";

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function generateName(): string {
  return `bot-${Math.random().toString(36).slice(2, 6)}`;
}

export async function runSetup(profile?: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const isDefault = !profile || profile === "default";
  const label = isDefault ? "default profile" : `profile "${profile}"`;

  console.log(`\n🛠  larkcc setup — configuring ${label}\n`);

  const app_id      = await prompt(rl, "  Feishu App ID     : ");
  const app_secret  = await prompt(rl, "  Feishu App Secret : ");

  let profileName = profile;
  if (!isDefault && !profileName) {
    const input = await prompt(rl, `  Profile name (blank to auto-generate): `);
    profileName = input || generateName();
    console.log(`  → Using name: ${profileName}`);
  }

  // 文件处理配置引导
  console.log("\n📁 File processing config (press Enter to use defaults):\n");

  const enabledInput = await prompt(rl, "  Enable file processing? [Y/n]: ");
  const fileEnabled = enabledInput.toLowerCase() !== "n";

  let fileConfig: Partial<FileConfig> | undefined;

  if (fileEnabled) {
    const sizeLimitInput = await prompt(rl, "  Max file size (MB) [30]: ");
    const sizeLimit = sizeLimitInput ? parseInt(sizeLimitInput) * 1024 * 1024 : 30 * 1024 * 1024;

    const timeoutInput = await prompt(rl, "  Multi-file timeout (seconds) [300]: ");
    const timeout = timeoutInput ? parseInt(timeoutInput) : 300;

    fileConfig = {
      enabled: true,
      size_limit: sizeLimit,
      multifile_timeout: timeout,
    };
  } else {
    fileConfig = { enabled: false };
  }

  rl.close();

  // owner_open_id 留空，首次收到消息时自动填入
  saveProfile(profileName, { app_id, app_secret, owner_open_id: "" }, fileConfig);
  logger.success(`Config saved to ${GLOBAL_CONFIG_PATH}`);
  logger.dim("Send any message to the bot to auto-detect your open_id\n");
}

export async function runNewProfile(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n🛠  larkcc — add new profile\n");

  const app_id       = await prompt(rl, "  Feishu App ID     : ");
  const app_secret   = await prompt(rl, "  Feishu App Secret : ");
  const nameInput    = await prompt(rl, "  Profile name (blank to auto-generate): ");
  const profileName  = nameInput || generateName();

  // 文件处理配置引导
  console.log("\n📁 File processing config (press Enter to use defaults):\n");

  const enabledInput = await prompt(rl, "  Enable file processing? [Y/n]: ");
  const fileEnabled = enabledInput.toLowerCase() !== "n";

  let fileConfig: Partial<FileConfig> | undefined;

  if (fileEnabled) {
    const sizeLimitInput = await prompt(rl, "  Max file size (MB) [30]: ");
    const sizeLimit = sizeLimitInput ? parseInt(sizeLimitInput) * 1024 * 1024 : 30 * 1024 * 1024;

    const timeoutInput = await prompt(rl, "  Multi-file timeout (seconds) [300]: ");
    const timeout = timeoutInput ? parseInt(timeoutInput) : 300;

    fileConfig = {
      enabled: true,
      size_limit: sizeLimit,
      multifile_timeout: timeout,
    };
  } else {
    fileConfig = { enabled: false };
  }

  rl.close();

  console.log(`  → Using name: ${profileName}`);
  saveProfile(profileName, { app_id, app_secret, owner_open_id: "" }, fileConfig);
  logger.success(`Profile "${profileName}" saved`);
  logger.dim("Send any message to the bot to auto-detect your open_id\n");

  return profileName;
}