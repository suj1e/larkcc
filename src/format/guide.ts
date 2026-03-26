/**
 * 飞书格式指导模块
 *
 * 从文件加载格式指导内容，注入到 Claude 的 system prompt 中。
 *
 * 文件优先级：
 * 1. ~/.larkcc/format-guide.md（用户自定义）
 * 2. resources/format-guide.md（随项目发布的默认文件）
 * 3. 内置默认内容（代码内 fallback）
 *
 * 注入方式：通过 query() 的 options.systemPrompt.append
 * 注入时机：每次调用 query() 时传入，整个会话生效
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

// ESM 兼容：__dirname 在 ESM 中不可用
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 内置默认格式指导（fallback）────────────────────────────────

const DEFAULT_FORMAT_GUIDE = `# 飞书格式规范

你的回复会通过飞书展示。短内容显示为交互式卡片，长内容写入飞书云文档。
两者对 Markdown 的支持不同，请严格遵守以下规范。

## 一、通用规则（卡片和文档都适用）

### 代码块
- 必须标注语言：\`\`\`typescript、\`\`\`python、\`\`\`bash 等
- 不要使用无语言标记的代码块（\`\`\`）
- 不要在代码块外使用 | 开头的文字（会被误识别为表格）

### 图片
- 不要使用外部图片链接 ![alt](https://...)
- 飞书只支持 img_xxx 格式的内部图片 key

### 段落
- 段落之间用空行分隔
- 不要用 <br> 或 HTML 标签控制换行

### 列表
- 嵌套不要超过 2 级
- 嵌套缩进统一用 2 个空格

### 不要使用
- HTML 标签（除了表格合并 <td colspan="2">，仅文档模式可用）
- 脚注 [^1]
- 折叠 <details>
- 任务列表外的复选框语法

## 二、卡片规则（短内容，显示为交互式卡片）

飞书卡片 Markdown 只支持有限的格式子集：

### 标题
- 只用 #### (H4) 和 ##### (H5)
- 不要使用 # ## ###（不会渲染为标题）

### 表格
- 列数不超过 5 列
- 不要使用 colspan/rowspan 合并（卡片不支持 HTML）
- 单元格内容尽量简短

### 不支持（不要在卡片内容中使用）
- > [!TYPE] Callout 语法
- $$ 数学公式
- 嵌套列表
- 删除线 ~~text~~

### 建议
- 代码块标注语言
- 使用 **粗体** 和 *斜体* 强调重点
- 使用 > 引用块
- 使用 --- 分割线

## 三、文档规则（长内容，写入飞书云文档）

飞书文档支持更丰富的格式：

### Callout 高亮块
使用 > [!TYPE] 语法，支持的类型和推荐 emoji：

| 类型 | 推荐 emoji | 用途 |
|------|-----------|------|
| > [!NOTE] | 💡 | 提示信息 |
| > [!TIP] | ✅ | 实用建议 |
| > [!WARNING] | ⚠️ | 注意事项 |
| > [!DANGER] | 🔴 | 危险操作 |
| > [!CAUTION] | 🟡 | 谨慎操作 |
| > [!INFO] | ℹ️ | 补充信息 |

示例：
> [!TIP] ✅
> 使用 async/await 可以避免回调地狱。

注意：
- Callout 中不要嵌套列表或表格（渲染会失败）
- 每条内容单独一行，用 > 开头

### 表格
- 列数建议不超过 6 列
- 单元格内容不超过 200 个字符
- 可以使用 <td colspan="N"> 合并列
- 不要在同一表格中混用合并单元格和普通单元格
- 表头和分隔符是必需的

### 数学公式
- 块级公式用 $$...$$
- 行内公式用 $...$
- 不要使用 \\\多行对齐（飞书不支持）
- 不要使用 \\begin{}...\\end{} 环境

### 代码块
- 必须标注语言（飞书会根据语言做语法高亮）
- 支持的语言：typescript, javascript, python, java, go, rust, bash, sql, json, yaml, xml, html, css, markdown, c, cpp, csharp, ruby, php, swift, kotlin, dart, r, matlab, scala, lua, perl, haskell, elixir, clojure, shell, powershell, dockerfile, makefile, toml, ini, diff, plaintext

### 标题
- 使用 H1-H6 完整层级
- 文档会保留原始标题级别

## 四、反面教材（这些会导致渲染失败或格式异常）

❌ 代码块外使用 | 开头 → 被误识别为表格
❌ Callout 中嵌套列表 → 渲染失败
❌ 数学公式使用多行对齐 → 公式显示异常
❌ 表格单元格内容超长 → 表格溢出文档宽度
❌ 超过 3 级的列表嵌套 → 只显示为 2 级
❌ 空的代码块（无语言标记且无内容）→ 创建失败
❌ 在段落之间不空行 → 段落粘连显示为一坨文字`;

// ── 文件路径 ───────────────────────────────────────────────────

function getUserGuidePath(): string {
  return path.join(os.homedir(), ".larkcc", "format-guide.md");
}

function getBundledGuidePaths(): string[] {
  return [
    // 编译后 dist/format/guide.js → dist/resources/format-guide.md
    path.join(__dirname, "..", "resources", "format-guide.md"),
    // 开发时 src/format/guide.ts → resources/format-guide.md
    path.join(__dirname, "..", "..", "resources", "format-guide.md"),
  ];
}

// ── 加载函数 ───────────────────────────────────────────────────

/**
 * 加载格式指导内容
 *
 * 优先级：
 * 1. ~/.larkcc/format-guide.md（用户自定义）
 * 2. resources/format-guide.md（随项目发布的默认文件）
 * 3. 内置默认内容（代码内 fallback）
 */
function loadFormatGuideContent(): string {
  // 1. 用户自定义文件
  const userPath = getUserGuidePath();
  try {
    if (fs.existsSync(userPath)) {
      const content = fs.readFileSync(userPath, "utf8").trim();
      if (content) {
        console.error(`[GUIDE] Loaded user format guide: ${userPath}`);
        return content;
      }
    }
  } catch (error) {
    console.error(`[GUIDE] Failed to read user guide: ${error}`);
  }

  // 2. 随项目发布的默认文件（优先 dist/resources/，其次项目根 resources/）
  const bundledPaths = getBundledGuidePaths();
  for (const bundledPath of bundledPaths) {
    try {
      if (fs.existsSync(bundledPath)) {
        const content = fs.readFileSync(bundledPath, "utf8").trim();
        if (content) {
          console.error(`[GUIDE] Loaded bundled format guide: ${bundledPath}`);
          return content;
        }
      }
    } catch (error) {
      console.error(`[GUIDE] Failed to read bundled guide ${bundledPath}: ${error}`);
    }
  }

  // 3. 内置默认
  console.error("[GUIDE] Using built-in default format guide");
  return DEFAULT_FORMAT_GUIDE;
}

// ── 缓存 ───────────────────────────────────────────────────────

let cachedGuide: string | null = null;

/**
 * 获取格式指导内容（带缓存）
 *
 * 只在第一次调用时读取文件，后续返回缓存。
 */
export function getFormatGuideContent(): string {
  if (cachedGuide !== null) {
    return cachedGuide;
  }
  cachedGuide = loadFormatGuideContent();
  return cachedGuide;
}
