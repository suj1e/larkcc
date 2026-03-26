/**
 * 飞书文档样式常量
 *
 * API 参考：
 * - 文档块 API: https://feishu.apifox.cn/doc-1950637
 * - 代码语言枚举: https://feishu.apifox.cn/doc-1950637
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
  GRID: 24,       // 分栏（Grid）
  GRID_COLUMN: 25,// 分栏列（GridColumn）
  IFRAME: 26,     // 内嵌网页
  IMAGE: 27,      // 图片
  VIEW: 33,       // 视图（容器块）
  TABLE: 31,      // 表格
  TABLE_CELL: 32, // 表格单元格
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

// 飞书官方语言ID对照表（CodeLanguage 枚举，ID范围1-75）
// 参考：https://feishu.apifox.cn/doc-1950637
export const LanguageMap: Record<string, number> = {
  // 1 - PlainText
  "": 1, "text": 1, "plain": 1, "txt": 1, "plaintext": 1,
  // 2 - ABAP
  "abap": 2,
  // 3 - Ada
  "ada": 3,
  // 4 - Apache
  "apache": 4, "apacheconf": 4,
  // 5 - Apex
  "apex": 5,
  // 6 - Assembly
  "assembly": 6, "asm": 6, "nasm": 6,
  // 7 - Bash
  "bash": 7, "sh": 7, "zsh": 7,
  // 8 - CSharp
  "csharp": 8, "cs": 8, "c#": 8,
  // 9 - C++
  "cpp": 9, "c++": 9, "cc": 9, "cxx": 9, "hpp": 9,
  // 10 - C
  "c": 10, "h": 10,
  // 11 - COBOL
  "cobol": 11, "cob": 11,
  // 12 - CSS
  "css": 12,
  // 13 - CoffeeScript
  "coffeescript": 13, "coffee": 13,
  // 14 - D
  "d": 14, "dlang": 14,
  // 15 - Dart
  "dart": 15,
  // 16 - Delphi
  "delphi": 16, "pas": 16, "pascal": 16,
  // 17 - Django
  "django": 17, "jinja": 17, "jinja2": 17,
  // 18 - Dockerfile
  "dockerfile": 18, "docker": 18,
  // 19 - Erlang
  "erlang": 19,
  // 20 - Fortran
  "fortran": 20, "f90": 20, "f95": 20, "f03": 20,
  // 21 - FoxPro
  "foxpro": 21, "vfp": 21,
  // 22 - Go
  "go": 22, "golang": 22,
  // 23 - Groovy
  "groovy": 23, "gradle": 23,
  // 24 - HTML
  "html": 24, "htm": 24, "svelte": 24,
  // 25 - HTMLBars
  "htmlbars": 25, "hbs": 25, "handlebars": 25,
  // 26 - HTTP
  "http": 26,
  // 27 - Haskell
  "haskell": 27, "hs": 27,
  // 28 - JSON
  "json": 28, "jsonc": 28, "json5": 28,
  // 29 - Java
  "java": 29,
  // 30 - JavaScript
  "javascript": 30, "js": 30, "mjs": 30, "cjs": 30, "jsx": 30,
  // 31 - Julia
  "julia": 31, "jl": 31,
  // 32 - Kotlin
  "kotlin": 32, "kt": 32, "kts": 32,
  // 33 - LateX
  "latex": 33, "tex": 33,
  // 34 - Lisp
  "lisp": 34, "el": 34, "elisp": 34, "common-lisp": 34, "cl": 34,
  // 35 - Logo
  "logo": 35,
  // 36 - Lua
  "lua": 36,
  // 37 - MATLAB
  "matlab": 37,
  // 38 - Makefile
  "makefile": 38, "make": 38, "mk": 38,
  // 39 - Markdown
  "markdown": 39, "md": 39, "mdown": 39, "mkd": 39,
  // 40 - Nginx
  "nginx": 40, "nginxconf": 40,
  // 41 - Objective
  "objectivec": 41, "objc": 41, "obj-c": 41, "objective-c": 41, "mm": 41,
  // 42 - OpenEdgeABL
  "openedgeabl": 42, "abl": 42, "progress": 42, "openedge": 42,
  // 43 - PHP
  "php": 43,
  // 44 - Perl
  "perl": 44, "pl": 44, "pm": 44,
  // 45 - PostScript
  "postscript": 45, "ps": 45, "eps": 45,
  // 46 - Power
  "power": 46, "powershell": 46, "ps1": 46, "pwsh": 46,
  // 47 - Prolog
  "prolog": 47,
  // 48 - ProtoBuf
  "protobuf": 48, "proto": 48,
  // 49 - Python
  "python": 49, "py": 49, "py3": 49, "pyw": 49,
  // 50 - R
  "r": 50, "rscript": 50,
  // 51 - RPG
  "rpg": 51,
  // 52 - Ruby
  "ruby": 52, "rb": 52, "gemfile": 52, "rakefile": 52,
  // 53 - Rust
  "rust": 53, "rs": 53,
  // 54 - SAS
  "sas": 54,
  // 55 - SCSS
  "scss": 55, "sass": 55,
  // 56 - SQL
  "sql": 56, "mysql": 56, "postgresql": 56, "postgres": 56, "pgsql": 56, "sqlite": 56,
  // 57 - Scala
  "scala": 57, "sc": 57,
  // 58 - Scheme
  "scheme": 58, "scm": 58, "ss": 58, "racket": 58,
  // 59 - Scratch
  "scratch": 59, "sb3": 59,
  // 60 - Shell
  "shell": 60, "env": 60, "bashrc": 60, "zshrc": 60, "profile": 60,
  // 61 - Swift
  "swift": 61,
  // 62 - Thrift
  "thrift": 62,
  // 63 - TypeScript
  "typescript": 63, "ts": 63, "tsx": 63, "mts": 63, "cts": 63,
  // 64 - VBScript
  "vbscript": 64, "vbs": 64, "vb": 64,
  // 65 - Visual
  "visual": 65, "vbnet": 65, "vb.net": 65,
  // 66 - XML
  "xml": 66, "xhtml": 66, "xslt": 66, "xsl": 66, "xsd": 66, "svg": 66, "pom": 66,
  // 67 - YAML
  "yaml": 67, "yml": 67,
  // 68 - CMake
  "cmake": 68,
  // 69 - Diff
  "diff": 69, "patch": 69, "udiff": 69,
  // 70 - Gherkin
  "gherkin": 70, "feature": 70, "cucumber": 70,
  // 71 - GraphQL
  "graphql": 71, "gql": 71, "graphqls": 71,
  // 72 - OpenGL Shading Language
  "glsl": 72, "vert": 72, "frag": 72, "shader": 72,
  // 73 - Properties
  "properties": 73, "ini": 73, "conf": 73, "config": 73, "cfg": 73,
  // 74 - Solidity
  "solidity": 74, "sol": 74,
  // 75 - TOML
  "toml": 75,
  // 默认
  "default": 1,
};

// 外部图片 emoji 标识
export const EXTERNAL_IMAGE_EMOJI = "🖼️";

// CSS 颜色名称到十六进制映射表
export const ColorNameMap: Record<string, string> = {
  // 基础颜色
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#00FF00",
  blue: "#0000FF",
  yellow: "#FFFF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  // 扩展颜色
  orange: "#FFA500",
  purple: "#800080",
  pink: "#FFC0CB",
  brown: "#A52A2A",
  gray: "#808080",
  grey: "#808080",
  silver: "#C0C0C0",
  gold: "#FFD700",
  navy: "#000080",
  teal: "#008080",
  olive: "#808000",
  maroon: "#800000",
  aqua: "#00FFFF",
  lime: "#00FF00",
  coral: "#FF7F50",
  salmon: "#FA8072",
  tomato: "#FF6347",
  crimson: "#DC143C",
  indigo: "#4B0082",
  violet: "#EE82EE",
  skyblue: "#87CEEB",
  lightblue: "#ADD8E6",
  darkblue: "#00008B",
  lightgreen: "#90EE90",
  darkgreen: "#006400",
  lightgray: "#D3D3D3",
  darkgray: "#A9A9A9",
};

// 文本对齐方式
export const AlignType = {
  LEFT: 1,
  CENTER: 2,
  RIGHT: 3,
} as const;
