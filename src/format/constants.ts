/**
 * 飞书文档样式常量
 */

// 飞书文档块类型
export const BlockType = {
  PAGE: 1,        // 页面
  TEXT: 2,        // 文本
  HEADING1: 3,    // 一级标题
  HEADING2: 4,    // 二级标题
  HEADING3: 5,    // 三级标题
  HEADING4: 6,    // 四级标题
  HEADING5: 7,    // 五级标题
  HEADING6: 8,    // 六级标题
  HEADING7: 9,    // 七级标题
  HEADING8: 10,   // 八级标题
  HEADING9: 11,   // 九级标题
  BULLET: 12,     // 无序列表
  ORDERED: 13,    // 有序列表
  CODE: 14,       // 代码块
  QUOTE: 15,      // 引用块
  EQUATION: 16,   // 公式块
  TODO: 17,       // 任务列表
  BITABLE: 18,    // 多维表格
  CALLOUT: 19,    // 高亮块
  CHAT_CARD: 20,  // 会话卡片
  DIAGRAM: 21,    // 流程图/UML
  DIVIDER: 22,    // 分割线
  FILE: 23,       // 文件
  TABLE: 24,      // 表格
  TABLE_CELL: 25, // 表格单元格
  IFRAME: 27,     // 内嵌网页
  IMAGE: 28,      // 图片
  VIEW: 29,       // 视图（容器块）
} as const;

// 飞书高亮块颜色
export const CalloutColors = {
  NOTE: "blue",      // 提示
  TIP: "green",      // 建议
  WARNING: "orange", // 警告
  DANGER: "red",     // 危险
  CAUTION: "red",    // 注意（同 danger）
  INFO: "blue",      // 信息（同 note）
} as const;

export type CalloutType = keyof typeof CalloutColors;

// 飞书官方语言ID对照表（ID范围1-75）
// 参考：https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/files/guide/create-document/create-new-document/create-new-document-overview
export const LanguageMap: Record<string, number> = {
  // 1 - PlainText
  "": 1, "text": 1, "plain": 1, "txt": 1,
  // 2 - ABAP
  "abap": 2,
  // 3 - Ada
  "ada": 3,
  // 4 - Apache
  "apache": 4, "apacheconf": 4,
  // 5 - Apex
  "apex": 5,
  // 6 - Assembly
  "assembly": 6, "asm": 6,
  // 7 - Bash
  "bash": 7, "sh": 7, "shell": 7, "zsh": 7,
  // 8 - C#
  "csharp": 8, "cs": 8,
  // 9 - C++
  "cpp": 9, "c++": 9, "cc": 9, "cxx": 9,
  // 10 - C
  "c": 10, "h": 10,
  // 11 - COBOL
  "cobol": 11, "cob": 11,
  // 12 - CSS
  "css": 12,
  // 13 - CoffeeScript
  "coffeescript": 13, "coffee": 13,
  // 14 - D
  "d": 14,
  // 15 - Dart
  "dart": 15,
  // 16 - Delphi
  "delphi": 16, "pas": 16, "pascal": 16,
  // 17 - Django
  "django": 17, "jinja": 17,
  // 18 - Dockerfile
  "dockerfile": 18, "docker": 18,
  // 19 - Erlang
  "erlang": 19,
  // 20 - Fortran
  "fortran": 20, "f90": 20, "f95": 20,
  // 21 - F#
  "fsharp": 21, "fs": 21,
  // 22 - Go
  "go": 22, "golang": 22,
  // 23 - Groovy
  "groovy": 23,
  // 24 - HTML
  "html": 24, "htm": 24,
  // 25 - Handlebars
  "handlebars": 25, "hbs": 25,
  // 26 - Haskell
  "haskell": 26, "hs": 26,
  // 27 - JSON
  "json": 27,
  // 28 - Java
  "java": 28,
  // 29 - JavaScript
  "javascript": 29, "js": 29, "mjs": 29, "cjs": 29,
  // 30 - Julia
  "julia": 30, "jl": 30,
  // 31 - Kotlin
  "kotlin": 31, "kt": 31, "kts": 31,
  // 32 - LaTeX
  "latex": 32, "tex": 32,
  // 33 - Less
  "less": 33,
  // 34 - Lisp
  "lisp": 34,
  // 35 - Lua
  "lua": 35,
  // 36 - MATLAB
  "matlab": 36,
  // 37 - Makefile
  "makefile": 37, "make": 37, "mk": 37,
  // 38 - Markdown
  "markdown": 38, "md": 38,
  // 39 - Nginx
  "nginx": 39,
  // 40 - Objective-C
  "objectivec": 40, "objc": 40, "obj-c": 40,
  // 41 - PHP
  "php": 41,
  // 42 - Perl
  "perl": 42, "pl": 42, "pm": 42,
  // 43 - PostgreSQL
  "postgresql": 43, "postgres": 43, "pgsql": 43,
  // 44 - PowerShell
  "powershell": 44, "ps1": 44, "pwsh": 44,
  // 45 - Python
  "python": 45, "py": 45,
  // 46 - R
  "r": 46,
  // 47 - Ruby
  "ruby": 47, "rb": 47,
  // 48 - Rust
  "rust": 48, "rs": 48,
  // 49 - SAS
  "sas": 49,
  // 50 - SCSS
  "scss": 50, "sass": 50,
  // 51 - SQL
  "sql": 51,
  // 52 - Scala
  "scala": 52,
  // 53 - Scheme
  "scheme": 53, "scm": 53,
  // 54 - Scratch
  "scratch": 54,
  // 55 - Shell (shell 已在 bash 中定义)
  // 56 - Swift
  "swift": 56,
  // 57 - Tcl
  "tcl": 57,
  // 58 - TypeScript
  "typescript": 58, "ts": 58, "tsx": 58,
  // 59 - VBScript
  "vbscript": 59, "vbs": 59,
  // 60 - Vue
  "vue": 60,
  // 61 - XML
  "xml": 61, "xhtml": 61, "xslt": 61,
  // 62 - YAML
  "yaml": 62, "yml": 62,
  // 63 - Zig
  "zig": 63,
  // 默认
  "default": 1,
};

// 外部图片 emoji 标识
export const EXTERNAL_IMAGE_EMOJI = "🖼️";
