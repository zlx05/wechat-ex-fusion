# 第三方许可声明 / Third-Party Licenses

本项目（wechat-ex-fusion）整合了三块组件。本文件列出每块的作者、来源与其原始 LICENSE，等于对上游的署名与致谢。各组件在其目录内保留了自己的 LICENSE 文件。

| 组件 | 目录 | 作者 / 来源 | 许可证 |
|---|---|---|---|
| 微信↔Claude Code 桥 | `wechat-claude-code/` | [Wechat-ggGitHub](https://github.com/Wechat-ggGitHub/wechat-claude-code) | MIT |
| 前任人设创作（create-ex） | `skills/create-ex/` | [therealXiaomanChu](https://github.com/therealXiaomanChu/ex-skill) | MIT |
| 微信聊天记录导出（wechat-chat-export） | `skills/wechat-chat-export/` | 本项目作者 | MIT（本项目） |
| 数据库解密工具 | （运行时 pip 安装，不随仓库分发） | [PyWxDump](https://github.com/xaoyaoo/PyWxDump)（PyPI: `pywxdump`） | 以其发布的 LICENSE 为准 |

## 各组件许可全文

### 1. wechat-claude-code — MIT © Wechat-ggGitHub

```text
MIT License

Copyright (c) 2026 Wechat-ggGitHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> 在本 fork 中，我们对 `wechat-claude-code` 作了扩展：新增 **双模式（人设聊天 / 任务助手）**、**会话按模式×时间分区、`/clear` 只清当前模式**、**`/update` 人设沉淀**、以及前任人设的注入与隔离。原始版权与许可证不变，仍归 Wechat-ggGitHub / MIT。

### 2. create-ex（原 ex-skill）— MIT © therealXiaomanChu

```text
MIT License

Copyright (c) 2026 therealXiaomanChu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 3. wechat-chat-export — MIT © 本项目作者（自研）

由本项目作者编写，随本项目以 MIT 许可发布。

### 4. PyWxDump — 独立第三方依赖

`wechat-chat-export` 在运行时通过 pip 安装 `pywxdump` 来读取微信数据库密钥并解密。它**不随本仓库分发**，仅作为运行时依赖被调用，其许可证与版权归原作者，请以 [其仓库](https://github.com/xaoyaoo/PyWxDump) 或 PyPI 页面公布的 LICENSE 为准。

> ⚠️ 合规提示：`pywxdump` 这类微信数据库解密工具可能随微信版本更新而失效，且使用第三方解析工具存在合规风险。请仅导出你本人本机、你有权访问的数据，并在使用前自行了解并承担相应责任（详见 `skills/wechat-chat-export/SKILL.md` 的「安全与合规」）。
