import readline from "readline";
import { saveProfile, listProfiles, GLOBAL_CONFIG_PATH } from "./config.js";
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

  const app_id       = await prompt(rl, "  Feishu App ID     : ");
  const app_secret   = await prompt(rl, "  Feishu App Secret : ");
  const owner_open_id = await prompt(rl, "  Your Open ID      : ");

  // 新建非默认 profile 时，支持自定义名字或自动生成
  let profileName = profile;
  if (!isDefault && !profileName) {
    const input = await prompt(rl, `  Profile name (blank to auto-generate): `);
    profileName = input || generateName();
    console.log(`  → Using name: ${profileName}`);
  }

  rl.close();

  saveProfile(profileName, { app_id, app_secret, owner_open_id });
  logger.success(`Config saved to ${GLOBAL_CONFIG_PATH}\n`);
}

export async function runNewProfile(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n🛠  larkcc — add new profile\n");

  const app_id        = await prompt(rl, "  Feishu App ID     : ");
  const app_secret    = await prompt(rl, "  Feishu App Secret : ");
  const owner_open_id = await prompt(rl, "  Your Open ID      : ");
  const nameInput     = await prompt(rl, "  Profile name (blank to auto-generate): ");
  const profileName   = nameInput || generateName();

  rl.close();

  console.log(`  → Using name: ${profileName}`);
  saveProfile(profileName, { app_id, app_secret, owner_open_id });
  logger.success(`Profile "${profileName}" saved\n`);

  return profileName;
}