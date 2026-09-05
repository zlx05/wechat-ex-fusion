# 常见问题排查（Troubleshooting）

按"先检查最容易的"排序。

## 1. `wxdump info` 拿不到 key 或版本偏移不支持

- **微信没在运行 / 没登录**：必须保证目标账号已在运行中的微信里登录。
- **版本太新/太旧**：PyWxDump 对新版支持有延迟。查看 `wxdump info` 是否报"版本偏移未收录"。解决办法：升级 `pywxdump`（`pip install -U pywxdump`）；仍不行就如实告知用户当前版本不被支持，不要硬编或编数据。
- **开了多个微信**：`wxdump info` 读的是主进程当前账号。它的 `wx_dir` 输出会告诉你读到了哪个账号，务必和目标账号目录对上。

## 2. `conda run -n <env> pywxdump` 报 "not recognized"

Windows 下 `conda run` 不保证把 `<env>\Scripts` 加入 PATH。**直接调用入口文件绝对路径**：
```
<env>\Scripts\wxdump.exe        # Windows
<env>/bin/wxdump                # Unix
```
同时满足：脚本入口名可能是 `wxdump`（不是 `pywxdump`）。

## 3. 中文乱码

给命令加前缀：`PYTHONIOENCODING=utf-8`。Git Bash / cmd 默认代码页不一致会导致。

## 4. 解密报错 / 报文件锁

微信运行中会持有 `-wal`、`-shm`。PyWxDump 一般能只读复制，但失败时：让用户**完全退出微信**（托盘菜单→退出），再跑解密。

## 5. 解出来的 ChatMsg.db 一片空

正常。**微信 3.9.12+ 把消息放到了 `Msg\Multi\MSG*.db` 分片库**，ChatMsg.db 只是过渡空表。按 SKILL 第四步去解 `Msg\Multi\MSG*.db`。

## 6. `export_chat.py` 报 "Contact not uniquely resolved"

- 联系人备注/昵称有重名 → 脚本会打印候选，选一个后加 `--wxid <wxid>` 重跑。
- 对方可能删了你 / 没存通讯录 → 让用户提供对方 wxid 直接传参。

## 7. 一条消息都没有导出

- **账号解错了**：解密库是否来自目标账号？（对比 `wxdump info` 的 `wx_dir`）
- 联系人确实没有历史，或记录被删除（微信本地的删除会清库）。
- 分片库缺：某些时候消息分散在多个 MSG*.db，确认第 4 步把 `Multi\MSG*.db` 全解了。

## 8. 微信 4.x（xwechat_files）

4.x 目录、加密方式与 3.x 不同，PyWxDump 对 4.x 的支持是逐步的。先升级 pywxdump 再试；不支持就明确告知，不要硬导。

## 9. 想连图片/视频文件一起导出

Markdown/JSON 里的 `[图片]` `[视频]` 是占位符。实体文件以私钥加密存在 `FileStorage`，需要额外的媒体解密步骤（按 aeskey + 文件头解密）。本 skill 管道暂时不内置，需要时单独处理。