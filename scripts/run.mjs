#!/usr/bin/env node
// -----------------------------------------------------------------------------
// wechat-ex-fusion 跨平台入口
// 用法: node scripts/run.mjs <setup|start|stop|extract|persona|daemon> [args...]
//
// 职责:
//   1. 读取仓库根 .env(若存在),补上融合项目默认的环境变量;
//   2. 把不同子命令分发到对应的进程(bot 守护进程 / claude 交互式 skill)。
//
// 所有子命令都跨平台(Win/macOS/Linux)。Windows 用户也可以用根目录的 *.bat。
// -----------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOT_DIR = join(ROOT, 'wechat-claude-code');

const EXTRACT_PROMPT = '请用 wechat-chat-export skill 帮我导出某个联系人的微信聊天记录';
const PERSONA_PROMPT = '请用 create-ex skill 帮我创建或更新前任人设';

// --- 读 .env(简单解析,不覆盖已存在的环境变量) ---------------------------------
function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf-8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

// --- 补齐融合项目默认值 ----------------------------------------------------------
function applyDefaults() {
  process.env.FUSION_ROOT = process.env.FUSION_ROOT || ROOT;
  process.env.WCC_DATA_DIR = process.env.WCC_DATA_DIR || join(ROOT, 'her', '.wcc');
  process.env.EXES_DIR = process.env.EXES_DIR || join(ROOT, 'exes');
}

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: 'inherit', env: process.env, ...opts });
}

// --- 确保 bot 已就绪(装依赖 + 编译出 dist/),只需做一次 --------------------------
// 新用户 clone / 下载 ZIP 后,dist/ 是构建产物、被 .gitignore 排除,不存在。
// setup/start/daemon 都依赖 dist/main.js,所以在此自动准备,否则会 MODULE_NOT_FOUND。
function ensureBotReady() {
  const pkgPath = join(BOT_DIR, 'package.json');
  const nodeModules = join(BOT_DIR, 'node_modules');
  const mainJs = join(BOT_DIR, 'dist', 'main.js');

  if (!existsSync(pkgPath)) {
    console.error(`✖ 找不到 bot 目录: ${BOT_DIR}`);
    console.error('   请确认这是完整的 wechat-ex-fusion 仓库(含 wechat-claude-code)。');
    process.exit(1);
  }
  if (existsSync(nodeModules) && existsSync(mainJs)) return; // 已就绪

  console.log('▶ 首次准备:bot 需要安装依赖并编译(只需一次,视网络约 1–2 分钟)…');
  if (!existsSync(nodeModules)) {
    console.log('   → 安装依赖(需可访问 npm 源)…');
    const r = spawnSync('npm', ['install'], { cwd: BOT_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) {
      console.error(`✖ 依赖安装失败(退出码 ${r.status})。`);
      console.error('   请检查网络 / npm 镜像,或手动在 wechat-claude-code 下执行:npm install');
      process.exit(r.status ?? 1);
    }
  }
  if (!existsSync(mainJs)) {
    console.log('   → 编译 TypeScript → dist/…');
    const r = spawnSync('npm', ['run', 'build'], { cwd: BOT_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) {
      console.error(`✖ 编译失败(退出码 ${r.status})。`);
      console.error('   请查看上方报错,或手动在 wechat-claude-code 下执行:npm run build');
      process.exit(r.status ?? 1);
    }
  }
  console.log('   ✓ bot 已就绪。');
}

function daemonStart() {
  ensureBotReady();
  applyDefaults(); // 保持与启动.bat 一致:bot 也拿到 fusion 环境变量
  console.log('▶ 正在启动机器人守护进程(前台运行,Ctrl+C 停止)…');
  const child = run(process.execPath, ['dist/main.js', 'start', '--wechat-ex-fusion'], { cwd: BOT_DIR });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function setup() {
  ensureBotReady();
  applyDefaults();
  console.log('▶ 扫码绑定微信(会弹出二维码,用微信扫一扫)…');
  const child = run(process.execPath, ['dist/main.js', 'setup', '--wechat-ex-fusion'], { cwd: BOT_DIR });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function stop() {
  if (process.platform === 'win32') {
    console.log('▶ 停止 bot 进程(匹配 --wechat-ex-fusion)…');
    const ps = 'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'node.exe\' -and $_.CommandLine -like \'*wechat-ex-fusion*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }';
    run('powershell', ['-NoProfile', '-Command', ps]);
  } else {
    console.log('▶ 停止 bot 进程(匹配 dist/main.js)…');
    run('pkill', ['-f', 'dist/main.js']);
  }
}

function extract() {
  const exportsDir = join(ROOT, 'exports');
  mkdirSync(exportsDir, { recursive: true });
  console.log('▶ 正在拉起 Claude Code,触发「微信聊天记录导出」skill…');
  console.log('   接下来会被问到「跟谁提取」;导出的 md/json 会落在 exports\\ 目录。');
  console.log('   提取完成后,用「设立人设」步骤时导入这份记录即可。');
  const child = run('claude', [EXTRACT_PROMPT], { cwd: exportsDir });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function persona() {
  console.log('▶ 正在拉起 Claude Code,触发「前任人设创作」skill…');
  console.log('   按提示操作;生成的人设会落在 exes\\ 目录(微信号聊天使用的就是它)。');
  const child = run('claude', [PERSONA_PROMPT], { cwd: ROOT });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function daemon(rest) {
  ensureBotReady();
  const sub = rest[0] ?? '';
  console.log(`▶ 转发到 daemon.sh(${sub || 'start'})…`);
  run('bash', [join(BOT_DIR, 'scripts', 'daemon.sh'), ...rest]);
}

function usage() {
  console.log(`用法: node scripts/run.mjs <命令>

  setup      扫码绑定微信(一次性,弹出二维码)
  start      启动机器人守护进程(前台运行)
  stop       停止机器人守护进程
  extract    拉起 Claude Code,导出某联系人微信聊天记录 → exports/
  persona    拉起 Claude Code,生成/更新前任人设 → exes/
  daemon     [start|stop|status|restart|logs]  mac/linux 后台常驻管理`);
  process.exit(0);
}

const command = process.argv[2];
const rest = process.argv.slice(3);

loadEnv();

switch (command) {
  case 'start': daemonStart(); break;
  case 'setup': setup(); break;
  case 'stop': stop(); break;
  case 'extract': extract(); break;
  case 'persona': persona(); break;
  case 'daemon': daemon(rest); break;
  default: usage();
}
