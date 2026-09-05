---
name: wechat-chat-export
description: General-purpose WeChat (Windows PC) chat-history export. Detects the local WeChat data folder and version, reads the DB key from the running client, decrypts the message databases, resolves a contact, and renders a read-only export (Markdown + JSON) of that contact's full history (text, emoji, images, voice, video-call, app links, system notes, recalls). | 通用微信聊天记录导出：自动探测本机微信数据目录与版本，从运行中的客户端读取数据库密钥，解密消息库，定位联系人，把该联系人的完整聊天记录导出为 Markdown + JSON（文字/表情/图片/语音/视频通话/app/系统消息/撤回均覆盖）。
argument-hint: [联系人昵称或备注]
version: 1.0.0
user-invocable: true
allowed-tools: Read, Write, Edit, Bash
---

> **Language / 语言**: Respond in the same language as the user's first message (中文/English).
> 根据用户第一条消息的语言，全程用同一语言回复。

# 微信聊天记录导出（通用 / Generic WeChat Chat Export）

## 触发条件

用户说以下任意内容时启动：
* `/wechat-chat-export`
* "导出跟 XX 的聊天记录"
* "帮我把微信聊天记录导出来"
* "找下微信数据目录，导出某人的记录"
* "export WeChat chat history"

## 适用范围与前提（先读，别跳）

1. **只处理用户自己电脑上、本机存储的微信数据**（Windows PC 版微信）。用途：导出自用记录 / 归档 / 备份。
2. **前提：微信 PC 端已启动，且目标账号已登录**。数据库解密密钥需要从运行中的 `WeChat.exe` 内存中读取（PyWxDump 实现）。若微信未运行，先请用户登录并启动。
3. 主验证环境：**微信 3.x**（含 3.9.12+ 分片存储）。**4.x**（`xwechat_files` 目录）尝试支持，若当前 PyWxDump 版本不支持其加密方式，要如实告诉用户，不要硬编数据。
4. 本 skill **不写死任何账号、路径、密钥**。每一步都自动探测、向用户确认目标后再做。
5. 只在用户明确授权的情况下导出。密钥和聊天内容敏感，见「安全与合规」。

## 工作流（六个步骤）

### 第 1 步：探测环境与数据目录（只读）

```bash
python3 "${CLAUDE_SKILL_DIR}/tools/wechat_detect.py"
# Windows 下若没有 python3，用 python
```

脚本只读、只用标准库，输出：微信数据根目录候选、账号目录列表、微信版本、消息库形态（`sharded` / `legacy`）、微信是否在运行。

信息不够时的兜底知识：
* 3.x 数据根目录默认 `C:\Users\<用户>\Documents\WeChat Files`；若用户改过路径，看注册表 `HKCU\Software\Tencent\WeChat\FileSavePath`。
* 账号子目录形如 `wxid_xxxxxxxxxxxx`。
* 4.x 数据根目录是 `Documents\xwechat_files`。

多账号时，根据 detect 结果让用户确认目标账号（或直接用当前登录账号）。

### 第 2 步：准备 Python 环境并安装 PyWxDump（教用户的 AI 自己装依赖）

按顺序找一个干净的 Python 环境，别的什么都别装：

1. 有 `conda`（`conda --version` 能跑）：
   ```bash
   conda create -n wechat-chat-export python=3.12 -y
   conda run -n wechat-chat-export pip install -r "${CLAUDE_SKILL_DIR}/requirements.txt"
   ```
2. 否则：
   ```bash
   python3 -m venv "${CLAUDE_SKILL_DIR}/.venv"
   "${CLAUDE_SKILL_DIR}/.venv/Scripts/python" -m pip install -r "${CLAUDE_SKILL_DIR}/requirements.txt"   # Windows
   # Unix: "${CLAUDE_SKILL_DIR}/.venv/bin/python" -m pip install -r "…/requirements.txt"
   ```

**关键坑（Windows）**：`conda run -n <env> pywxdump` 经常报 "not recognized"，因为 `conda run` 不保证把 `Scripts` 加进 PATH。**不要依赖 `conda run` 里的裸命令**，改成直接调用入口文件路径：
* Windows：`<env>\Scripts\wxdump.exe`
* Unix：`<env>/bin/wxdump`
并给命令加 `PYTHONIOENCODING=utf-8` 前缀防中文乱码。装完先 `wxdump.exe --help` 验证能用。

### 第 3 步：读取当前登录账号的数据库密钥

```bash
PYTHONIOENCODING=utf-8 "<env>/Scripts/wxdump.exe" info
```

输出含：`account / nickname / wxid / key / wx_dir`。
* **确认**：输出的 `wx_dir`（就是账号根目录）必须等于第 1 步选定的目标账号目录。若账号不对，让用户切换微信账号登录后重跑。
* key 是 32 字节 hex。只在命令行里当参数用，**不写进任何文件**。

### 第 4 步：定位并解密数据库

在目标账号目录下定位消息库和通讯录库：

| 形态 | 消息库位置 |
|---|---|
| 分片存储（3.9.12+） | `<wxdir>\Msg\Multi\MSG*.db`（如 MSG0.db … MSGn.db） |
| 旧版（<3.9.12） | `<wxdir>\Msg\ChatMsg.db`（个别版本 `Msg\MSG.db`） |
| 通讯录（所有 3.x） | `<wxdir>\Msg\MicroMsg.db` |
| 4.x | 见 `docs/SCHEMA.md`；若 PyWxDump 暂不支持就如实说明 |

对每个要用到的 db 文件执行：
```bash
PYTHONIOENCODING=utf-8 "<env>/Scripts/wxdump.exe" decrypt -k "<key>" -i "<db文件>" -o "<解密输出目录>"
```
输出目录里得到 `de_<原名>.db`。消息库 + MicroMsg.db 一起解。

### 第 5 步：解析联系人并导出

```bash
python3 "${CLAUDE_SKILL_DIR}/tools/export_chat.py" \
  --decrypted "<解密输出目录>" \
  --contact "<联系人昵称或备注>" \
  --self-name "我"
```

脚本行为：
* 在解密库里自动找联系人：优先精确匹配备注或昵称，再放宽到**前缀/包含模糊匹配**；按备注 → 昵称排序展示候选。
* 找到唯一匹配 → 直接导出；多条匹配 → 打印候选让用户确认；没找到 → 提示用户可改传 `--wxid <微信ID>`。
* 产物：`<联系人>_聊天记录.md` + `<联系人>_聊天记录.json`，写在当前目录（可用 `--out <目录>` 指定）。
* 覆盖类型：文字、表情、图片、语音、视频通话/语音通话记录、app 链接/卡片、系统消息、撤回消息。新类型未覆盖时，读 `docs/SCHEMA.md` 补充渲染，不要乱猜。

导出成功后打印两个文件的**完整路径**给用户，并问是否需要转成 txt/html/csv。

### 第 6 步：清理

解密库是中间产物（可能几百 MB）。导出成功后**询问用户**：删除解码库，还是保留以便换格式重导。密钥、日志不留明文、不落盘到会被扩散的位置。

## 工具表

| 工具 | 用途 | 依赖 |
|---|---|---|
| `tools/wechat_detect.py` | 探测微信数据目录/账号/版本/消息库形态/运行状态 | 仅标准库 |
| `tools/export_chat.py` | 在解密库上定位联系人并导出 Markdown/JSON | 仅标准库 + sqlite3 |

`pywxdump`（第 2~4 步）由 SKILL 指导运行时安装到独立环境，工具脚本本身不依赖它。

## 关键知识参考

- DB 结构、消息 `type` 字段含义、各版本差异：见 **[`docs/SCHEMA.md`](docs/SCHEMA.md)**。不确定列名/类型时先读它再动手。
- 常见问题（多账号、key 失败、`-wal` 锁、4.x 不支持等）：见 [docs/TROUBLESHOOT.md](docs/TROUBLESHOOT.md)。

## ⚠️ 安全与合规

- 只允许导出**用户本人本机、本人所有/有权访问的微信数据**。不用于刺探他人数据。
- 数据库密钥与聊天内容敏感：不写入仓库、不贴到会转发的对话、不留日志明文。
- 这类解密工具随微信更新可能失效；使用第三方解析工具存在合规风险，需向用户如实说明、由用户自行承担。本 skill 与工具分离维护，不捆绑第三方二进制。

## 与 create-ex 的配合

本 skill 的输出（`<联系人>_聊天记录.md` / `.json`）可直接作为 [create-ex](https://github.com/therealXiaomanChu/ex-skill) 的原料输入，用于把该联系人"蒸馏"成可对话的 Skill。