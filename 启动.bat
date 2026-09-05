@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，本工具依赖它运行。
  echo 请先安装 Node.js 的 LTS 版本，版本需 ≥18。
  echo 下载地址：https://nodejs.org/
  echo 安装完成后重新双击本按钮即可。
  pause
  exit /b 1
)
cd /d "%~dp0"
node scripts\run.mjs start
pause
