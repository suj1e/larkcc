/**
 * 工具标签共享常量
 *
 * 统一管理工具名到显示文本的映射，消除 claude.ts / task-panel.ts / message.ts 三处重复。
 */

export const TOOL_LABELS: Record<string, string> = {
  Read:            "📂 读取文件",
  Write:           "✏️  写入文件",
  Edit:            "✏️  编辑文件",
  Bash:            "⚡ 执行命令",
  Glob:            "🔍 查找文件",
  Grep:            "🔎 搜索内容",
  LS:              "📁 列出目录",
  ExitPlanMode:    "📋 退出计划模式",
  AskUserQuestion: "💬 提问",
};

export const TOOL_DISPLAY: Record<string, string> = {
  Read: "📂 Read", Write: "📝 Write", Edit: "✏️ Edit",
  Bash: "⚡ Bash", Glob: "📂 Glob", Grep: "🔍 Grep",
  LS: "📁 LS",
};

export const TOOL_STATUS_WORDS: Record<string, string[]> = {
  Read:  ["📖 Reading...", "📖 Scanning..."],
  Write: ["📝 Writing...", "📝 Creating..."],
  Edit:  ["✏️ Editing...", "✏️ Modifying..."],
  Bash:  ["⚡ Running...", "⚡ Executing..."],
  Glob:  ["📂 Finding files...", "📂 Scanning..."],
  Grep:  ["🔍 Searching...", "🔍 Analyzing..."],
  LS:    ["📁 Listing...", "📁 Browsing..."],
};
