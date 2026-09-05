# 微信 PC (Windows) 数据结构与导出参考

给执行本 skill 的 AI 当"字典"，不确定列名/类型/版本差异时先读这里，不要猜。

## 1. 目录与文件布局

### 微信 3.x（`WeChat Files`）

```
C:\Users\<用户>\Documents\WeChat Files\          <- 数据根目录(可在设置里改;注册表 FileSavePath 记录实际位置)
└── <账号目录: wxid_xxxx 或自定义名>\
    ├── Msg\
    │   ├── Multi\                    <- 3.9.12+ 的分片消息存储
    │   │   ├── MSG0.db ... MSGn.db   消息正文(分片,按时间滚动)
    │   │   ├── FTSMSG*.db            搜索索引(不需要导出)
    │   │   └── MediaMSG*.db          媒体消息索引(可选)
    │   ├── ChatMsg.db                老版本(<3.9.12)主消息库;3.9.12+ 只是过渡表,基本为空
    │   ├── MicroMsg.db               通讯录(Contact 表在这里)
    │   ├── Media.db                  多媒体元信息
    │   └── MMKV\                     密钥/配置(mmkv 格式)
    └── FileStorage\                  图片/视频/文件实体(私钥加密,导出媒体需额外解密)
```

### 微信 4.x（`xwechat_files`）

```
Documents\xwechat_files\
└── <wxid>\  (内部结构为 db_storage/msg 等,DB 路径和加密方式与 3.x 不同)
```

4.x 支持程度取决于 PyWxDump 当前版本。**若不支持就当明说，不要硬编。**

## 2. 消息库表结构（已验证 3.9.12 分片 MSG*.db）

`MSG` 表关键列（`tools/export_chat.py` 按小写名自动匹配，兼容大小写变体）：

| 概念 | 列名（3.9.12 分片） | 说明 |
|---|---|---|
| 对话对象 | `StrTalker` | 对方的 wxid；群聊为 `xxxx@chatroom` |
| 数值 ID | `TalkerId` | 关联 `Name2ID` 表的 rowid（可不用） |
| 时间 | `CreateTime` | Unix 秒 |
| 类型 | `Type` / `SubType` | 见下方消息类型表 |
| 方向 | `IsSender` | 1=自己发的，0=对方发的 |
| 内容 | `StrContent` | 文本直接是正文；图片/表情/App 是 XML 或空 |
| 去重 | `MsgSvrID` | 服务端消息 ID（跨分片/表去重用） |

其他版本：
- Kafka 换过结构但大致类似：老版 `ChatMsg.db` 的 `MSG` 表用 `talker` 列（同为 wxid/@chatroom），内容列是 `strContent`/`content`。
- `ChatCRMsg`/`ChatMsg`（3.9.12 过渡表）通常为空，可忽略；`MSGTrans` 是暂存表，缺内容列，不会干扰。

## 3. 消息 Type 字段（导出渲染用）

| Type | 含义 | 渲染 | 备注 |
|---|---|---|---|
| 1 | 文本 | 原文 | `StrContent` 即正文 |
| 3 | 图片 | `[图片]` | 文件在 FileStorage，另行提取 |
| 34 | 语音 | `[语音]` | sil 格式，可转 amr/mp3（需额外工具） |
| 43 | 视频 | `[视频]` | 文件在 FileStorage |
| 47 | 表情 | `[表情]` | XML 内 `<emoji>` 有 md5；收藏表情名的映射表不在库内 |
| 49 | App/链接/文件/通话邀请 | 见下 | 内容在 XML 的 `<appmsg>` 里 |
| 10000 | 系统消息 | 去标签取文字 | 如 `<revokemsg>…撤回…</revokemsg>`、拍一拍 |
| 10002 | 撤回 | `[撤回了一条消息]` | |

**Type 49 关键 SubType：**

| SubType | 含义 | 渲染 |
|---|---|---|
| 57 | 视频通话 | `[视频通话]` |
| 6 | 语音通话 | `[语音通话]` |
| 5 | 文件 | 解析 `<appmsg><title>` 的文件名 |
| 0 / 33 / 其他 | 链接卡片/小程序 | 解析 `<title>` `<des>` `<url>` |

## 4. 通讯录（MicroMsg.db → Contact）

关键列：`UserName`（= 对方 wxid）、`NickName`（昵称）、`Remark`（备注）、`Alias`（微信号）、`Type`。
找人优先按 `Remark` 精确匹配 → `NickName` → 前缀/包含模糊；实在不行让用户直接给 `--wxid`。

## 5. 解密密钥

- 32 字节 hex。
- 来源：微信运行时从内存读取（`wxdump info`；只对**当前登录且运行中**的进程有效）。
- 密钥对应的 `wx_dir` 一定要和目标账号目录对上（多账号时极易错）。
- 拿到密钥 → `wxdump decrypt -k <key> -i <db> -o <out>` 得到 `de_*.db`。

## 6. 注意事项

- 微信运行时会锁库并有 `-wal`/`-shm`；PyWxDump 解密自带只读复制，一般 OK。若解密报错，先让用户完全退出微信再试。
- `Msg/Multi/MMKV`、`config` 等不是消息库，别解。
- 输出中文乱码时加环境变量 `PYTHONIOENCODING=utf-8`。