# larkcc

[![npm version](https://badge.fury.io/js/larkcc.svg)](https://badge.fury.io/js/larkcc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Claude Code in Feishu — 在任意项目目录启动，通过飞书机器人与 Claude 对话，体验等同于终端直接使用 Claude Code。

## 安装

```bash
npm install -g larkcc
```

从源码安装：

```bash
git clone https://github.com/suj1e/larkcc.git
cd larkcc && chmod +x install.sh && ./install.sh
```

## 快速开始

```bash
larkcc --setup          # 配置机器人（只需 App ID 和 Secret）
cd /your/project
larkcc                  # 启动
```

首次发消息自动检测并保存 open_id，之后即可正常使用。

## 命令

```bash
larkcc                  # 启动（默认机器人，新会话）
larkcc -c               # 继续上次会话
larkcc -p mybot         # 使用指定 profile
larkcc -d               # 后台运行
larkcc --setup          # 配置机器人
larkcc --help           # 查看所有命令
```

## 功能

- 流式输出 — 打字机效果逐字显示，支持 CardKit 和 update 两种模式
- 超长消息 — 自动写入飞书云文档，回复文档链接
- 思考过程 — Claude 扩展思考以折叠面板显示
- 图片理解 — 支持截图、富文本多图、外部图片自动上传
- 文件分析 — 发送文件给 Claude 分析，支持多文件模式
- 群聊支持 — 多机器人同群，通过 @ 或引用分别控制
- Slash 命令 — 内置快捷命令，支持自定义 prompt 和 exec 命令
- 反应状态 — 处理中打 Typing，完成换 DONE
- 响应元数据 — 每条回复显示耗时、模型、token 用量
- 多机器人 — 多 profile 独立管理，同一台机器运行多个实例

## Slash 命令

### 快速执行（不走 Claude，秒返回）

| 命令 | 说明 |
|------|------|
| `/stop` `/cancel` | 中断当前任务 |
| `/s` `/status` | git status + 最近提交 |
| `/d` `/diff` | git diff |
| `/l` `/log` | git log |
| `/b` `/branch` | 分支列表 |
| `/pwd` | 当前目录 + 文件列表 |
| `/ps` | 运行中的进程 |

### Claude 快捷方式

| 命令 | 说明 |
|------|------|
| `/review` | 代码 review |
| `/fix` | 修复报错 |
| `/doc` | 生成/更新 README |
| `/test [文件]` | 生成单元测试 |
| `/explain [文件]` | 解释代码 |
| `/refactor [文件]` | 重构 |
| `/commit` | 生成 commit message |
| `/pr` | 生成 PR 描述 |
| `/todo` | 整理 TODO 清单 |
| `/summary` | 生成工作日报 |
| `/bsx [内容]` | 头脑风暴，不动代码 |
| `/quality [路径]` | 代码质量检查 |
| `/release [类型]` | 生成 CHANGELOG + 执行 release.sh |
| `/check` | 综合检查（类型/lint/测试） |
| `/security` | 安全漏洞扫描 |
| `/deps` | 检查过期依赖 |
| `/upmd` | 更新 README.md 和 CLAUDE.md |
| `/build` | 构建项目 |
| `/install` | 安装依赖 |
| `/run [script]` | 运行 npm script |
| `/help` | 查看所有命令 |

### 多文件模式

| 命令 | 说明 |
|------|------|
| `/mf start` | 开始多文件模式 |
| `/mf done` | 结束并发送所有缓存的文件 |

### 自定义命令

```yaml
# ~/.larkcc/config.yml
commands:
  deploy: "按标准流程部署到测试环境"
  impl: "直接实现以下需求，不要讨论：\n\n{input}"

exec_commands:
  docker: "docker ps -a"
  dc: "docker-compose {{args}}"
  logs: "tail -n {{n|100}} {{file}}"
```

占位符：`{input}` 用于 prompt 命令，`{{args}}` / `{{param|default}}` 用于 exec 命令。

## 群聊

把多个机器人拉进同一个飞书群，通过 @ 或引用回复分别控制：

- 群消息：@ 机器人或引用机器人的消息才会触发
- 单聊：直接发消息即可
- 单聊和群聊共用同一个 Claude session

额外权限：`im:message.group_at_msg:readonly`

## 配置

`~/.larkcc/config.yml`：

```yaml
feishu:
  app_id: cli_xxxxxxxx
  app_secret: xxxxxxxxxxxxxxxx
  owner_open_id: ou_xxxxxxxx   # 首次收到消息后自动填入

claude:
  permission_mode: acceptEdits
  allowed_tools: [Read, Write, Edit, Bash, Glob, Grep, LS]

# 流式输出
streaming:
  enabled: true
  mode: cardkit                # cardkit | update | none
  flush_interval_ms: 300
  thinking_enabled: false      # 显示思考过程
  fallback_on_error: true

# 超长消息
overflow:
  mode: document               # document（云文档）| chunk（分片）
  document:
    threshold: 2800
    title_template: "{cwd} - {session_id} - {datetime}"
    cleanup:
      enabled: true
      max_docs: 50
      notify: true

# 格式
card_title: Claude              # 卡片标题，留空不显示
format_guide:
  enabled: true                 # 注入飞书格式要求到 prompt
image_resolver:
  enabled: true                 # 外部图片自动上传
image_prompt: "分析图片，给出回应"

# 文件处理
file:
  enabled: true
  size_limit: 31457280          # 30MB
  multifile_timeout: 300

# 自定义命令
commands: {}
exec_commands: {}
exec_security:
  enabled: true
  blacklist: ["rm -rf", "sudo", "mkfs"]
  confirm_on_warning: true

# 多机器人
profiles:
  mybot:
    feishu:
      app_id: cli_bot_xxx
      app_secret: xxxxxxxxxxxxxxxx
```

标题模板占位符：`{cwd}` `{session_id}` `{datetime}` `{date}` `{profile}`

## 飞书权限

在 [飞书开发者后台](https://open.feishu.cn/) 开通以下权限，然后创建新版本并发布：

| 权限 | 用途 | 必需 |
|------|------|------|
| `im:message` | 基础消息（含图片/文件下载） | 是 |
| `im:message:send_as_bot` | 发送/回复/更新消息 | 是 |
| `im:message.p2p_msg:readonly` | 接收私聊消息 | 是 |
| `im:message.reactions:write_only` | 打 reaction 状态 | 是 |
| `cardkit:card:write` | CardKit 流式输出 | 推荐 |
| `im:message.group_at_msg:readonly` | 接收群 @ 消息 | 群聊 |
| `docx:document` | 创建/编辑云文档 | 文档模式 |
| `drive:file` | 删除云空间文件 | 文档清理 |

事件订阅：使用**长连接** → 订阅 `im.message.receive_v1`

## 相关资源

- [飞书文档块 API](https://feishu.apifox.cn/doc-1950637) — 文档块类型、属性、代码语言枚举
- [飞书 MCP 服务](https://mcp.feishu.cn) — 文档创建 MCP 端点

## License

[MIT](LICENSE)

## Disclaimer

This project is not officially affiliated with Lark, Feishu, or ByteDance.
