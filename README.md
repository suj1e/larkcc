# larkcc

[![npm version](https://badge.fury.io/js/larkcc.svg)](https://badge.fury.io/js/larkcc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Claude Code in Feishu — 在任意项目目录启动，通过飞书机器人与 Claude 对话，体验等同于终端直接使用 Claude Code。

## Install

```bash
npm install -g larkcc
```

## Quick Start

```bash
larkcc --setup          # 配置机器人（只需 App ID 和 Secret）
cd /your/project
larkcc                  # 启动
```

首次发消息自动检测并保存 open_id，之后即可正常使用。

## CLI

```bash
larkcc                  # 启动（默认机器人，新会话）
larkcc -c               # 继续上次会话
larkcc -p mybot         # 使用指定 profile
larkcc -d               # 后台运行
larkcc --setup          # 配置机器人
larkcc --help           # 查看所有命令
```

## Features

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

## Slash Commands

发送 `/help` 查看所有可用命令。支持自定义命令：

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

## Group Chat

把多个机器人拉进同一个飞书群，通过 @ 或引用回复分别控制：

- 群消息：@ 机器人或引用机器人的消息才会触发
- 单聊：直接发消息即可
- 单聊和群聊共用同一个 Claude session

额外权限：`im:message.group_at_msg:readonly`

## Configuration

`~/.larkcc/config.yml`，`larkcc --setup` 自动生成：

```yaml
feishu:
  app_id: cli_xxxxxxxx
  app_secret: xxxxxxxxxxxxxxxx

# Claude
claude:
  permission_mode: acceptEdits
  allowed_tools: [Read, Write, Edit, Bash, Glob, Grep, LS]

# 流式输出（默认 cardkit）
streaming:
  mode: cardkit                # cardkit | update | none

# 超长消息 → 云文档
overflow:
  mode: document               # document | chunk

# 多机器人
profiles:
  mybot:
    feishu:
      app_id: cli_bot_xxx
      app_secret: xxxxxxxxxxxxxxxx
```

完整配置项见 `src/config.ts`。

## Permissions

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

## License

[MIT](LICENSE)

## Disclaimer

This project is not officially affiliated with Lark, Feishu, or ByteDance.
