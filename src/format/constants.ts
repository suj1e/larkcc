/**
 * 飞书文档样式常量
 *
 * API 参考：
 * - 文档块 API: https://feishu.apifox.cn/doc-1950637
 * - 代码语言枚举: https://feishu.apifox.cn/doc-1950637
 */

// ── 文档块类型 ───────────────────────────────────────────────────

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

// ── 飞书颜色枚举 ───────────────────────────────────────────────────

/**
 * 文字颜色（text_element_style.text_color）
 * 1=Pink, 2=Orange, 3=Yellow, 4=Green, 5=Blue, 6=Purple, 7=Gray
 */
export const FontColor = {
  PINK: 1,
  ORANGE: 2,
  YELLOW: 3,
  GREEN: 4,
  BLUE: 5,
  PURPLE: 6,
  GRAY: 7,
} as const;

/**
 * 文字背景色（text_element_style.background_color）
 * 1-7=Light 系列, 8-14=Dark 系列
 */
export const FontBgColor = {
  LIGHT_PINK: 1,
  LIGHT_ORANGE: 2,
  LIGHT_YELLOW: 3,
  LIGHT_GREEN: 4,
  LIGHT_BLUE: 5,
  LIGHT_PURPLE: 6,
  LIGHT_GRAY: 7,
  DARK_PINK: 8,
  DARK_ORANGE: 9,
  DARK_YELLOW: 10,
  DARK_GREEN: 11,
  DARK_BLUE: 12,
  DARK_PURPLE: 13,
  DARK_GRAY: 14,
} as const;

/**
 * 高亮块背景色（callout.background_color）
 * 枚举值与 FontBgColor 相同
 */
export const CalloutBgColor = FontBgColor;

/**
 * 高亮块边框色（callout.border_color）
 * 1=Red, 2=Orange, 3=Yellow, 4=Green, 5=Blue, 6=Purple, 7=Gray
 */
export const CalloutBorderColor = {
  RED: 1,
  ORANGE: 2,
  YELLOW: 3,
  GREEN: 4,
  BLUE: 5,
  PURPLE: 6,
  GRAY: 7,
} as const;

// ── 高亮块颜色映射 ───────────────────────────────────────────────────

export const CalloutColorMap: Record<CalloutType, { bg: number; border: number }> = {
  NOTE:    { bg: CalloutBgColor.LIGHT_BLUE,   border: CalloutBorderColor.BLUE },
  TIP:     { bg: CalloutBgColor.LIGHT_GREEN,  border: CalloutBorderColor.GREEN },
  WARNING: { bg: CalloutBgColor.LIGHT_ORANGE, border: CalloutBorderColor.ORANGE },
  DANGER:  { bg: CalloutBgColor.LIGHT_PINK,   border: CalloutBorderColor.RED },
  CAUTION: { bg: CalloutBgColor.LIGHT_PINK,   border: CalloutBorderColor.RED },
  INFO:    { bg: CalloutBgColor.LIGHT_BLUE,   border: CalloutBorderColor.BLUE },
};

export type CalloutType = "NOTE" | "TIP" | "WARNING" | "DANGER" | "CAUTION" | "INFO";

// ── CSS 颜色名 → 飞书 FontColor 数字映射 ───────────────────────────────

/**
 * CSS 颜色名称到飞书 FontColor 枚举值的映射
 * 飞书只有 7 种文字颜色，CSS 颜色名按色相家族分组
 */
export const FontColorNameMap: Record<string, number> = {
  // Pink/Red 家族
  pink: FontColor.PINK, red: FontColor.PINK, crimson: FontColor.PINK,
  coral: FontColor.PINK, salmon: FontColor.PINK, tomato: FontColor.PINK,
  maroon: FontColor.PINK, rosybrown: FontColor.PINK, indianred: FontColor.PINK,
  firebrick: FontColor.PINK, darkred: FontColor.PINK,
  // Orange 家族
  orange: FontColor.ORANGE, gold: FontColor.ORANGE,
  darkorange: FontColor.ORANGE, orangered: FontColor.ORANGE,
  peru: FontColor.ORANGE, chocolate: FontColor.ORANGE, sienna: FontColor.ORANGE,
  // Yellow 家族
  yellow: FontColor.YELLOW, olive: FontColor.YELLOW, khaki: FontColor.YELLOW,
  darkkhaki: FontColor.YELLOW, palegoldenrod: FontColor.YELLOW,
  // Green 家族
  green: FontColor.GREEN, teal: FontColor.GREEN, cyan: FontColor.GREEN,
  aqua: FontColor.GREEN, lime: FontColor.GREEN, limegreen: FontColor.GREEN,
  lightgreen: FontColor.GREEN, darkgreen: FontColor.GREEN, forestgreen: FontColor.GREEN,
  seagreen: FontColor.GREEN, mediumseagreen: FontColor.GREEN, springgreen: FontColor.GREEN,
  mintcream: FontColor.GREEN, mediumaquamarine: FontColor.GREEN, aquamarine: FontColor.GREEN,
  // Blue 家族
  blue: FontColor.BLUE, navy: FontColor.BLUE, skyblue: FontColor.BLUE,
  lightblue: FontColor.BLUE, darkblue: FontColor.BLUE, royalblue: FontColor.BLUE,
  steelblue: FontColor.BLUE, dodgerblue: FontColor.BLUE, cornflowerblue: FontColor.BLUE,
  midnightblue: FontColor.BLUE, slateblue: FontColor.BLUE, mediumblue: FontColor.BLUE,
  cadetblue: FontColor.BLUE, deepskyblue: FontColor.BLUE, powderblue: FontColor.BLUE,
  lightsteelblue: FontColor.BLUE, lightcyan: FontColor.BLUE,
  indigo: FontColor.BLUE,
  // Purple 家族
  purple: FontColor.PURPLE, violet: FontColor.PURPLE, magenta: FontColor.PURPLE,
  fuchsia: FontColor.PURPLE, plum: FontColor.PURPLE, orchid: FontColor.PURPLE,
  mediumorchid: FontColor.PURPLE, darkorchid: FontColor.PURPLE,
  darkviolet: FontColor.PURPLE, blueviolet: FontColor.PURPLE,
  darkmagenta: FontColor.PURPLE, mediumpurple: FontColor.PURPLE,
  mediumslateblue: FontColor.PURPLE, slategray: FontColor.PURPLE,
  // Gray 家族
  gray: FontColor.GRAY, grey: FontColor.GRAY, silver: FontColor.GRAY,
  white: FontColor.GRAY, black: FontColor.GRAY,
  darkgray: FontColor.GRAY, darkgrey: FontColor.GRAY,
  lightgray: FontColor.GRAY, lightgrey: FontColor.GRAY,
  dimgray: FontColor.GRAY, dimgrey: FontColor.GRAY,
  lightslategray: FontColor.GRAY,
  gainsboro: FontColor.GRAY, whitesmoke: FontColor.GRAY,
  snow: FontColor.GRAY, ghostwhite: FontColor.GRAY, lavender: FontColor.GRAY,
};

/**
 * CSS 颜色名称到飞书 FontBgColor 枚举值的映射
 * 带 dark 前缀的映射到 8-14，其他映射到 1-7
 */
export const FontBgColorNameMap: Record<string, number> = {
  // Light 系列 (1-7)
  pink: FontBgColor.LIGHT_PINK, lightpink: FontBgColor.LIGHT_PINK, red: FontBgColor.LIGHT_PINK,
  orange: FontBgColor.LIGHT_ORANGE, lightorange: FontBgColor.LIGHT_ORANGE,
  yellow: FontBgColor.LIGHT_YELLOW, lightyellow: FontBgColor.LIGHT_YELLOW, khaki: FontBgColor.LIGHT_YELLOW,
  green: FontBgColor.LIGHT_GREEN, lightgreen: FontBgColor.LIGHT_GREEN, lime: FontBgColor.LIGHT_GREEN,
  cyan: FontBgColor.LIGHT_GREEN, aqua: FontBgColor.LIGHT_GREEN,
  blue: FontBgColor.LIGHT_BLUE, lightblue: FontBgColor.LIGHT_BLUE, skyblue: FontBgColor.LIGHT_BLUE,
  purple: FontBgColor.LIGHT_PURPLE, violet: FontBgColor.LIGHT_PURPLE, plum: FontBgColor.LIGHT_PURPLE,
  gray: FontBgColor.LIGHT_GRAY, grey: FontBgColor.LIGHT_GRAY, silver: FontBgColor.LIGHT_GRAY,
  lightgray: FontBgColor.LIGHT_GRAY, lightgrey: FontBgColor.LIGHT_GRAY,
  // Dark 系列 (8-14)
  darkpink: FontBgColor.DARK_PINK, darkred: FontBgColor.DARK_PINK,
  crimson: FontBgColor.DARK_PINK, maroon: FontBgColor.DARK_PINK,
  darkorange: FontBgColor.DARK_ORANGE,
  darkyellow: FontBgColor.DARK_YELLOW, olive: FontBgColor.DARK_YELLOW,
  darkgreen: FontBgColor.DARK_GREEN, forestgreen: FontBgColor.DARK_GREEN,
  darkblue: FontBgColor.DARK_BLUE, navy: FontBgColor.DARK_BLUE, midnightblue: FontBgColor.DARK_BLUE,
  darkpurple: FontBgColor.DARK_PURPLE, indigo: FontBgColor.DARK_PURPLE,
  darkviolet: FontBgColor.DARK_PURPLE, darkmagenta: FontBgColor.DARK_PURPLE,
  darkgray: FontBgColor.DARK_GRAY, darkgrey: FontBgColor.DARK_GRAY,
  dimgray: FontBgColor.DARK_GRAY, dimgrey: FontBgColor.DARK_GRAY,
};

// ── 代码语言 ───────────────────────────────────────────────────

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

// ── 外部图片 emoji 标识 ───────────────────────────────────────────────────

export const EXTERNAL_IMAGE_EMOJI = "🖼️";

// ── 文本对齐方式 ───────────────────────────────────────────────────

export const AlignType = {
  LEFT: 1,
  CENTER: 2,
  RIGHT: 3,
} as const;
