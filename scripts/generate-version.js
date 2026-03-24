#!/usr/bin/env node
/**
 * 从 package.json 读取版本号，生成 src/version.ts
 * 在构建前自动执行，确保版本号同步
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 读取 package.json
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const version = pkg.version;

// 生成 version.ts 内容
const content = `// 自动生成，请勿手动修改
// 由 scripts/generate-version.js 从 package.json 生成

export const VERSION = "${version}";
`;

// 写入文件
const versionPath = path.join(rootDir, 'src', 'version.ts');
fs.writeFileSync(versionPath, content, 'utf-8');

console.log(`✅ Generated src/version.ts: v${version}`);
