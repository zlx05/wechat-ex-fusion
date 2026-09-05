# wechat-chat-export

通用微信聊天记录导出 Skill（Claude Code）。把某位联系人的微信 PC 端聊天记录从本机数据中完整导出为 **Markdown + JSON**。

通用性：不写死任何账号/路径/密钥；自动探测微信版本与数据目录；运行时自动装 `pywxdump` 依赖；适配 3.x（含 3.9.12 分片存储）与 4.x（能力取决于 pywxdump 版本）。

## 安装

```bash
# 全局（推荐）
cp -r wechat-chat-export ~/.claude/skills/wechat-chat-export
# 或项目内
mkdir -p .claude/skills
cp -r wechat-chat-export .claude/skills/wechat-chat-export
```

依赖（`pywxdump`）在首次使用时由 Skill 自动装进独立 Python 环境，不需要手动装。

## 使用

对 Claude 说：**"导出我微信里跟 XX 的聊天记录"**（XX 是对方备注或昵称），或 `/wechat-chat-export`。

流程（详见 [SKILL.md](SKILL.md)）：

1. `tools/wechat_detect.py` 探测微信数据目录/账号/版本（只读）
2. 自动创建 Python 环境并 `pip install pywxdump`
3. `wxdump info` 从运行中的微信读取解密密钥
4. 解密消息库（自动识别分片/老版）+ 通讯录
5. `tools/export_chat.py --decrypted <解密库目录> --contact "<昵称/备注>"` → 导出 md + json
6. 询问是否清理中间解密库

### 可调参数

```bash
python3 tools/export_chat.py \
  --decrypted <解密输出目录> \
  --contact "<联系人昵称或备注>" \
  [--wxid <微信ID>] \
  [--self-name "我"] \
  [--out <输出目录>]
```

也支持直接给 `--wxid` 跳过联系人模糊匹配。

## 目录结构

```
wechat-chat-export/
├── SKILL.md              # Skill 主指令
├── requirements.txt      # pywxdump
├── tools/
│   ├── wechat_detect.py  # 数据目录/版本/形态探测（只读、标准库）
│   └── export_chat.py    # 联系人定位 + Markdown/JSON 导出（标准库+sqlite3）
└── docs/
    ├── SCHEMA.md         # DB 结构/消息类型/版本差异参考
    └── TROUBLESHOOT.md   # 常见问题排查
```

## 隐私与合规

- 只导出用户本人本机数据；密钥与聊天内容敏感，不落盘、不外传。
- 解密类工具随微信更新可能失效，且存在合规风险，请用户自行知悉承担。

## 输出兼容性

导出的 `<联系人>_聊天记录.md / .json` 可直接作为 [create-ex](https://github.com/therealXiaomanChu/ex-skill) 的原料，用于把联系人蒸馏成可对话的 Skill。