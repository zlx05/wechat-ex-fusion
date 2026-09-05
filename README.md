<div align="center">

# wechat-ex-fusion

**把前任做成微信里的 AI —— 微信聊天记录导出 · 前任人设创作 · 微信↔Claude Code 桥接**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node-18%2B-blue.svg)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.9%2B-blue.svg)](https://python.org)

</div>

---

## ✨ 亮点

| 亮点 | 说明 |
|---|---|
| **双模式 · 完全隔离** | 聊天模式（前任人设）与任务模式（`/task` 中性助手）彼此独立：各自的 Claude 会话、各自的工作目录、各自的记忆。切过去聊正事，**绝不会污染** Ta 的人设与你们的聊天氛围。 |
| **会话按模式 × 时间分区** | 聊天 / 任务各存各的对话档，文件名带起始时间（如 `chat-20260905-000835.json`）。`/clear` **只清当前模式**、开新档案，另一模式原样保留，旧档留盘可查。 |
| **`/update` 人设自动沉淀** | 聊得越久，人设越像。`/update` 只读最近聊天，增量蒸馏进 persona + 记忆，自动留版本可回滚；系统回执与任务消息**永不写回**对话档案。 |
| **扫码即用 · 数据全本地** | 不用注册、不用服务器，微信扫码绑定一分钟搞定。所有会话、人设、记录都在你自己电脑上。 |
| **消息不刷屏** | 只推送进度、结果、关键决策；工具调用等噪音自动过滤。 |
| **双向文件** | 发图片 / Word / PDF 给 AI；AI 生成的文件也直接推回微信。 |
| **「对方正在输入中…」** | AI 处理时，微信顶部实时显示输入状态。 |

---

## 🧩 三块构成

```
wechat-ex-fusion/
├── wechat-claude-code/          # ③ 微信绑定桥（连微信 ↔ Claude Code CLI）
├── skills/
│   ├── wechat-chat-export/      # ① 微信聊天记录导出（自研）
│   └── create-ex/               # ② 前任人设创作（上游 ex-skill）
├── scripts/run.mjs              # 跨平台入口（setup/start/stop/extract/persona）
├── 启动.bat · 扫码绑定.bat · 停止.bat · 设立人设.bat · 提取信息.bat   # Windows 一键
└── docs/images/                 # 教学截图
```

三步协作：**① 导数据**（wechat-chat-export）→ **② 造人设**（create-ex）→ **③ 挂在微信上聊**（wechat-claude-code）。

---

## 📋 前置条件

- **Node.js ≥ 18**（[下载 LTS](https://nodejs.org/en/download)）——**必须先装**，整个 bot 靠 Node.js 运行；双击 `扫码绑定.bat` 等按钮若检测不到 Node 会提示安装。
- **Claude Code CLI** 已安装并完成认证（[官方指南](https://docs.anthropic.com/en/docs/claude-code)）；需在 `~/.claude/skills/` 下能看到自定义 skill
- **Python 3.9+**（仅「提取信息」步骤用；用于调用 PyWxDump）
- **个人微信账号**（扫码绑定）
- 需要 Python 可选：`pip3 install pywxdump`（提取微信记录时用，也可由 skill 自动装入）

> Claude Code 支持第三方 API（OpenRouter、AWS Bedrock 等），设置 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_API_KEY` 即可。

---

## 🚀 快速开始

### 方式一：Windows 一键（五个按钮）

在项目根目录双击：

| 按钮 | 作用 |
|---|---|
| `扫码绑定.bat` | 弹出二维码，用微信扫一扫绑定 |
| `提取信息.bat` | 拉起 Claude Code，导出某联系人聊天记录 → `exports/` |
| `设立人设.bat` | 拉起 Claude Code，生成 / 更新前任人设 → `exes/` |
| `启动.bat` | 启动机器人服务（前台运行，Ctrl+C 停止） |
| `停止.bat` | 停止机器人服务 |

> 提示：**首次使用**点按钮会自动安装依赖并编译，并自动把 `skills/` 下的两个 skill 装进 `~/.claude/skills/`（需能访问 npm 源，约 1–2 分钟）；已就绪后不会重复。

### 方式二：跨平台（Win / macOS / Linux 通用）

> 首次执行任意 npm 命令会**自动安装依赖并编译**，并自动把仓库自带的两个 skill 装进 `~/.claude/skills/`，无需手动准备。macOS / Linux 用户以此为准；Windows 用户也可在 WSL / git-bash 里执行。

```bash
# 1. 扫码绑定微信（首次会自动装依赖、编译，并自动安装两个 skill）
npm run setup            # 或 扫码绑定.bat

# 2. 提取某人的聊天记录（可选，但推荐。会问到「跟谁提取」）
npm run extract          # 或 提取信息.bat  → 结果落 exports/

# 3. 生成前任人设（导入上一步 exports/ 里的记录）
npm run persona          # 或 设立人设.bat  → 生成 exes/<slug>/

# 4. 启动机器人
npm start                # 或 启动.bat
```

然后打开微信，给新出现的那个「机器人好友」发条消息试试。

macOS / Linux 想后台常驻、开机自启，用：

```bash
npm run daemon -- start      # stop / status / restart / logs
```

---

## 💬 微信端命令

直接在微信对话框发：

| 命令 | 说明 |
|---|---|
| `/task [内容]` | 切到任务模式（中性助手），后续对话都算任务；带内容则立即执行 |
| `/chat [内容]` | 切回聊天模式（前任人设）；带内容则立即交给人设回复 |
| `/mode` | 查看当前模式 |
| `/update` | 把最近聊天沉淀进前任人设（自动留版本） |
| `/clear` | **只清当前模式**对话并开新档案，另一模式不受影响，旧档留盘 |
| `/reset` | 完全重置当前模式（含工作目录等设置） |
| `/compact` | 压缩上下文，开始新 Claude 会话（历史保留） |
| `/history [数量]` | 查看最近对话（默认 20 条） |
| `/undo [数量]` | 撤销最近几条对话 |
| `/status` | 查看会话状态（模式 / 工作目录 / 模型 / 会话ID） |
| `/model <名称>` | 切换 Claude 模型 |
| `/cwd <路径>` | 查看 / 切换工作目录 |
| `/prompt <内容>` | 查看 / 设置系统提示词 |
| `/send <路径>` | 发送本地文件（图片直接显示，其他作附件） |
| `/skills` | 列出已安装的 skill |
| `/<skill>` | 触发任意已安装的 skill（如 `/wechat-chat-export`、`/create-ex`） |

---

## ⚙️ 工作原理

```
微信（手机） ←→ iLink Bot API ←→ Node 守护进程（wechat-claude-code） ←→ Claude Code CLI（本地）
```

守护进程通过长轮询监听微信消息，转发给本地 `claude` CLI 处理，回复实时流式推送回微信。全程跑在你自己电脑上。聊天模式用「前任人设」当系统提示，任务模式用中性助手提示，两者在内存与落盘上都是隔离的。

---

## 📁 数据目录与隐私

默认所有数据都在**这个项目目录内**，且已被 `.gitignore` 排除、不会上传：

```
her/            # bot 数据目录：config.json / sessions（会话档案）/ accounts 等
exes/           # 前任人设目录（真人数据）：persona.md / memory.md / SKILL.md / versions/
exports/        # 提取出来的聊天记录（个人数据）
docs/images/.private/   # 含个人信息的本地截图（不打码不公开）
```

> 各环境变量（`WCC_DATA_DIR` / `FUSION_ROOT` / `EXES_DIR` / `HER_SLUG`）可复制 `.env.example` 为 `.env` 覆盖，默认跟随项目目录。

**协议与隐私边界**：

- 只导出**你自己电脑**上、**你有权访问**的微信数据；密钥与内容不落盘、不外传。
- 微信数据库解密依赖第三方 `pywxdump`，可能随微信更新失效，且存在合规风险，请自行了解并承担。
- 本项目定位是「把回忆存档、做镜子」，**不鼓励**对前任的不健康执念。如果你发现自己过于沉浸，请寻求专业帮助。


---

## 📄 License

本项目以 [MIT](LICENSE) 许可发布，内含由以下上游项目派生 / 引入的组件，各组件保留其原始 LICENSE：

| 组件 | 作者 / 来源 | 许可 |
|---|---|---|
| wechat-claude-code | [Wechat-ggGitHub](https://github.com/Wechat-ggGitHub/wechat-claude-code) | MIT |
| create-ex | [therealXiaomanChu](https://github.com/therealXiaomanChu/ex-skill) | MIT |
| wechat-chat-export | 本项目作者 | MIT |
| PyWxDump（运行时依赖） | [xaoyaoo/PyWxDump](https://github.com/xaoyaoo/PyWxDump) | 以其发布许可为准 |

详见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。

---

> 人的记忆是一种不讲道理的存储介质。你记不住高数公式，却清楚记得四年前的一个下午 ta 穿了一件白 T 恤站在便利店门口等你，手里拿着两根冰棍——一根给你，一根 ta 自己。这个工具，就是把那些不公平的记忆，从生物硬盘导到数字硬盘的格式转换器。
