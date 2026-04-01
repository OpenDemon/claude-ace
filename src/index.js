/**
 * index.js — Claude-ACE Interactive CLI
 * Author: OpenDemon
 *
 * v0.8.0: 扩展国产模型支持（通义千问、DeepSeek、MiniMax、Kimi）
 * v0.7.0: Complete slash command set
 *   /help /clear /stats /status /skills /resume /rename /rewind /release-notes /exit
 *   /memory  — view/delete cross-project memory entries
 *   /watchdog — show watchdog status, pause/resume, force scan
 *   /callgraph <file> — analyze call dependencies of a file
 *   /model [name] — show or switch current model (no restart needed)
 *   /compact — summarize and compress conversation history to save tokens
 *   /export — export current conversation to Markdown file
 *   /init — create .claude-ace.json config in current project
 *   /doctor — check environment: API key, model, node version, tree-sitter
 *   /cost — estimate cost of current session based on token usage
 */
import readline from 'readline';
import chalk from 'chalk';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { select, input } from '@inquirer/prompts';
import { Agent } from './agent/Agent.js';
import { WatchdogAgent } from './watchdog/WatchdogAgent.js';
import { SessionManager } from './session/SessionManager.js';
import { CrossProjectMemory } from './memory/CrossProjectMemory.js';
import { CallGraphTool } from './tools/CallGraphTool.js';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execSync } from 'child_process';
import { Worker } from 'worker_threads';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const VERSION = '0.8.3';
let currentModel = process.env.OPENAI_MODEL || 'glm-5-turbo';

// 按提供商分别存储 API Key 的配置文件（~/.ace-keys.json）
const ACE_KEYS_FILE = path.join(os.homedir(), '.ace-keys.json');

function loadProviderKeys() {
  try {
    if (fs.existsSync(ACE_KEYS_FILE)) {
      return JSON.parse(fs.readFileSync(ACE_KEYS_FILE, 'utf-8'));
    }
  } catch (_) {}
  return {};
}

function saveProviderKey(providerName, apiKey) {
  const keys = loadProviderKeys();
  keys[providerName] = apiKey;
  try {
    fs.writeFileSync(ACE_KEYS_FILE, JSON.stringify(keys, null, 2) + '\n', { mode: 0o600 });
  } catch (_) {}
}

function getProviderKey(providerName) {
  const keys = loadProviderKeys();
  return keys[providerName] || '';
}

const RELEASE_NOTES = `
## v0.8.0
- 新增通义千问（Qwen）模型支持：qwen-turbo、qwen-plus、qwen-max
- 新增 DeepSeek 模型支持：deepseek-chat、deepseek-reasoner
- 新增 MiniMax 模型支持：MiniMax-Text-01、abab6.5s-chat
- 新增 Kimi 模型支持：moonshot-v1-8k、moonshot-v1-32k、moonshot-v1-128k
- /model 命令展示分组模型列表，包含 API 申请地址
- /doctor 命令自动识别当前模型提供商并显示配置帮助
- /cost 命令支持全部新模型的价格估算

## v0.7.0
- 新增 /memory  — 查看、删除跨项目记忆库条目
- 新增 /watchdog — 查看守护进程状态、暂停/恢复、立即扫描
- 新增 /callgraph <file> — 直接分析文件调用图
- 新增 /model [name] — 运行时切换模型，无需重启
- 新增 /compact — 压缩对话历史节省 Token
- 新增 /export — 导出当前对话为 Markdown 文件
- 新增 /init — 在当前目录初始化 .claude-ace.json 配置
- 新增 /doctor — 检查环境配置（API Key、模型、Node 版本等）
- 新增 /cost — 估算当前会话费用

## v0.6.0
- 启动界面展示最近对话历史（Recent Activity）
- 新增 /status、/skills、/resume、/rename、/rewind、/release-notes 命令
- 对话历史本地持久化（保存到 ~/.claude-ace/sessions/）

## v0.5.0
- Claude Code 风格 ASCII logo
- 信任确认菜单
- / 触发交互式命令菜单

## v0.4.0
- 流式输出打字机效果
- Markdown 渲染与代码高亮
- 工具调用实时显示

## v0.3.0
- CallGraph 调用图分析
- CriticalArchitectTool + MemoryTool 全面集成
- WatchdogAgent 真实运行 npm test

## v0.2.0
- ExpandSymbolTool 按需展开
- IntentVerify Fallback 保障
- CrossProjectMemory 三问质量门控

## v0.1.0
- 五大维度初始实现
- Token 消耗降低 84.5%
`;

// ─── Markdown renderer ────────────────────────────────────────────────────────
marked.use(markedTerminal({
  code: (code) => {
    const lines = code.split('\n');
    const maxLen = Math.max(...lines.map(l => l.length), 40);
    const w = Math.min(maxLen + 2, 76);
    const top    = chalk.gray(' \u250c' + '\u2500'.repeat(w) + '\u2510');
    const bottom = chalk.gray(' \u2514' + '\u2500'.repeat(w) + '\u2518');
    const body = lines.map(l => chalk.gray(' \u2502 ') + chalk.greenBright(l)).join('\n');
    return `\n${top}\n${body}\n${bottom}\n`;
  },
  codespan: (code) => chalk.cyanBright('`' + code + '`'),
  strong:   (text) => chalk.bold.white(text),
  em:       (text) => chalk.italic.gray(text),
  heading:  (text, level) => '\n' + chalk.bold.yellow('#'.repeat(level) + ' ' + text) + '\n',
  listitem: (text) => chalk.gray(' \u2022 ') + text,
  hr:       ()     => chalk.gray(' ' + '\u2500'.repeat(60)) + '\n',
  link:     (href, _title, text) => chalk.blue.underline(text || href),
}));

function renderMarkdown(text) {
  try { return marked(text); } catch (_) { return text; }
}

// ─── Tool display config ──────────────────────────────────────────────────────
const TOOL_DISPLAY = {
  FileRead:          { label: 'Reading' },
  FileWrite:         { label: 'Writing' },
  Bash:              { label: 'Running' },
  Grep:              { label: 'Searching' },
  SemanticSearch:    { label: 'Semantic search' },
  IntentVerify:      { label: 'Verifying' },
  ExpandSymbol:      { label: 'Expanding' },
  CriticalArchitect: { label: 'Architecture review' },
  Memory:            { label: 'Memory' },
  CallGraph:         { label: 'Call graph' },
};

function formatArgHint(name, args) {
  if (!args) return '';
  const val = args.path || args.targetFile || args.query || args.command || args.intent || args.action || '';
  if (!val) return '';
  const s = String(val);
  return chalk.gray(' ' + (s.length > 55 ? s.slice(0, 52) + '...' : s));
}

// ─── Banner with recent activity (Claude Code style) ─────────────────────────
function printBanner(sessions) {
  const cwd = process.cwd();
  const leftW = 34;
  const rightW = 44;

  const line = (left, right) => {
    return chalk.gray('\u2502') + left + chalk.gray('\u2502') + right + chalk.gray('\u2502');
  };

  // 使用 string-width 准确计算终端显示宽度（中文/emoji/ASCII art 全部正确）
  const pad = (str, w) => {
    const plain = stripAnsi(str);
    const spaces = Math.max(0, w - stringWidth(plain));
    return str + ' '.repeat(spaces);
  };

  console.log('');
  console.log(chalk.gray('\u256d' + '\u2500'.repeat(leftW) + '\u252c' + '\u2500'.repeat(rightW + 1) + '\u2500\u256e'));

  const logoLine1 = '  ' + chalk.bold.cyan('\u258c\u2580\u2588\u2588\u2588\u2584\u2590\u2588') + '  ' + chalk.bold.white('Claude-ACE') + chalk.gray(' v' + VERSION);
  const recentTitle = ' ' + chalk.bold.white('Recent activity');
  console.log(line(pad(logoLine1, leftW), pad(recentTitle, rightW + 1)));

  const logoLine2 = '  ' + chalk.bold.cyan('\u2580\u2584\u2588\u2588\u2588\u2588\u2588\u2580\u2588\u2580') + '  ' + chalk.gray('GitHub: OpenDemon');
  const recent = sessions.slice(0, 4);
  const r0 = recent[0]
    ? ' ' + chalk.gray(SessionManager.relativeTime(recent[0].updatedAt).padEnd(8)) + ' ' + chalk.white((recent[0].name || '').slice(0, 30))
    : ' ' + chalk.gray('\u6682\u65e0\u5386\u53f2\u8bb0\u5f55');
  console.log(line(pad(logoLine2, leftW), pad(r0, rightW + 1)));

  const logoLine3 = '  ' + chalk.bold.cyan('  \u2598\u2598 \u259d\u259d') + '    ' + chalk.gray(cwd.length > 22 ? '...' + cwd.slice(-19) : cwd);
  const r1 = recent[1]
    ? ' ' + chalk.gray(SessionManager.relativeTime(recent[1].updatedAt).padEnd(8)) + ' ' + chalk.white((recent[1].name || '').slice(0, 30))
    : '';
  console.log(line(pad(logoLine3, leftW), pad(r1, rightW + 1)));

  const modelLine = '  ' + chalk.bold.yellow('\u2665 90% Token') + chalk.gray(' \u00b7 OpenAI/\u56fd\u4ea7\u6a21\u578b');
  const r2 = recent[2]
    ? ' ' + chalk.gray(SessionManager.relativeTime(recent[2].updatedAt).padEnd(8)) + ' ' + chalk.white((recent[2].name || '').slice(0, 30))
    : '';
  console.log(line(pad(modelLine, leftW), pad(r2, rightW + 1)));

  const r3 = recent[3]
    ? ' ' + chalk.gray(SessionManager.relativeTime(recent[3].updatedAt).padEnd(8)) + ' ' + chalk.white((recent[3].name || '').slice(0, 30))
    : '';
  const resumeHint = sessions.length > 4 ? ' ' + chalk.gray('/resume \u67e5\u770b\u66f4\u591a') : r3;
  console.log(line(pad('', leftW), pad(resumeHint, rightW + 1)));

  console.log(chalk.gray('\u2570' + '\u2500'.repeat(leftW) + '\u2534' + '\u2500'.repeat(rightW + 1) + '\u2500\u256f'));
  console.log('');
}

// ─── Trust confirmation ───────────────────────────────────────────────────────
async function confirmTrust() {
  const cwd = process.cwd();
  console.log(chalk.gray('\u2500'.repeat(80)));
  console.log(chalk.white(' \u5de5\u4f5c\u76ee\u5f55\uff1a'));
  console.log('');
  console.log(chalk.white(' ' + cwd));
  console.log('');
  console.log(chalk.white(' \u5b89\u5168\u786e\u8ba4\uff1a\u8fd9\u662f\u60a8\u521b\u5efa\u7684\u9879\u76ee\u6216\u60a8\u4fe1\u4efb\u7684\u9879\u76ee\u5417\uff1f'));
  console.log(chalk.gray(' Claude-ACE \u5c06\u80fd\u591f\u8bfb\u53d6\u3001\u7f16\u8f91\u548c\u6267\u884c\u6b64\u76ee\u5f55\u4e2d\u7684\u6587\u4ef6\u3002'));
  console.log('');
  console.log(chalk.gray('\u2500'.repeat(80)));
  console.log('');
  try {
    const answer = await select({
      message: '',
      choices: [
        { name: chalk.white('1. \u662f\uff0c\u6211\u4fe1\u4efb\u6b64\u76ee\u5f55'), value: 'yes' },
        { name: chalk.gray('2. \u5426\uff0c\u9000\u51fa'), value: 'no' },
      ],
      theme: { prefix: '', style: { highlight: (t) => chalk.bold.cyan(t) } }
    });
    return answer === 'yes';
  } catch (_) { return false; }
}

// ─── Slash command menu ───────────────────────────────────────────────────────
const SLASH_COMMANDS = [
  { name: '/help              \u663e\u793a\u5e2e\u52a9\u4fe1\u606f',                    value: '/help' },
  { name: '/clear             \u6e05\u7a7a\u5f53\u524d\u5bf9\u8bdd\u5386\u53f2',             value: '/clear' },
  { name: '/compact           \u538b\u7f29\u5bf9\u8bdd\u5386\u53f2\u8282\u7701 Token',        value: '/compact' },
  { name: '/stats             \u663e\u793a Token \u7edf\u8ba1',                   value: '/stats' },
  { name: '/cost              \u4f30\u7b97\u5f53\u524d\u4f1a\u8bdd\u8d39\u7528',             value: '/cost' },
  { name: '/status            \u663e\u793a\u7248\u672c\u3001\u6a21\u578b\u3001API \u8fde\u901a\u6027',   value: '/status' },
  { name: '/doctor            \u68c0\u67e5\u73af\u5883\u914d\u7f6e\u662f\u5426\u6b63\u786e',         value: '/doctor' },
  { name: '/model [name]      \u67e5\u770b\u6216\u5207\u6362\u6a21\u578b',              value: '/model' },
  { name: '/setup             重新配置所有提供商的 API Key',    value: '/setup' },
  { name: '/skills            \u5217\u51fa\u6240\u6709 ACE \u5de5\u5177\u80fd\u529b',         value: '/skills' },
  { name: '/memory            \u67e5\u770b\u8de8\u9879\u76ee\u8bb0\u5fc6\u5e93',             value: '/memory' },
  { name: '/watchdog          \u67e5\u770b/\u63a7\u5236\u5b88\u62a4\u8fdb\u7a0b',            value: '/watchdog' },
  { name: '/callgraph <file>  \u5206\u6790\u6587\u4ef6\u8c03\u7528\u56fe',              value: '/callgraph' },
  { name: '/resume            \u6062\u590d\u4e4b\u524d\u7684\u5bf9\u8bdd',              value: '/resume' },
  { name: '/rename            \u91cd\u547d\u540d\u5f53\u524d\u5bf9\u8bdd',              value: '/rename' },
  { name: '/rewind            \u56de\u9000\u5230\u4e0a\u4e00\u6761\u6d88\u606f\u4e4b\u524d',         value: '/rewind' },
  { name: '/export            \u5bfc\u51fa\u5bf9\u8bdd\u4e3a Markdown \u6587\u4ef6',     value: '/export' },
  { name: '/init              \u521d\u59cb\u5316\u9879\u76ee ACE \u914d\u7f6e\u6587\u4ef6',    value: '/init' },
  { name: '/release-notes     \u67e5\u770b\u7248\u672c\u66f4\u65b0\u65e5\u5fd7',             value: '/release-notes' },
  { name: '/exit              \u9000\u51fa\u7a0b\u5e8f',                      value: '/exit' },
];

async function showSlashMenu() {
  try {
    return await select({
      message: '\u547d\u4ee4',
      choices: SLASH_COMMANDS,
      theme: { prefix: chalk.gray('/'), style: { highlight: (t) => chalk.bold.cyan(t) } }
    });
  } catch (_) { return null; }
}

// ─── Individual command implementations ──────────────────────────────────────

function printHelp() {
  console.log('');
  console.log(chalk.bold.white(' \u547d\u4ee4\uff1a'));
  for (const cmd of SLASH_COMMANDS) {
    const parts = cmd.name.split(/\s{2,}/);
    const cmdPart = parts[0].trim();
    const descPart = parts.slice(1).join('  ').trim();
    console.log('  ' + chalk.cyan(cmdPart.padEnd(22)) + chalk.gray(descPart));
  }
  console.log('');
  console.log(chalk.gray('  \u8f93\u5165 / \u5f39\u51fa\u547d\u4ee4\u83dc\u5355\uff0c\u4e0a\u4e0b\u7bad\u5934\u5207\u6362\u3002'));
  console.log('');
}

function printStats(stats) {
  console.log('');
  console.log(chalk.bold.white(' Token \u7edf\u8ba1\uff1a'));
  console.log('  \u8f93\u5165\uff1a  ' + chalk.yellow(stats.inputTokens.toLocaleString()) + ' tokens');
  console.log('  \u8f93\u51fa\uff1a  ' + chalk.yellow(stats.outputTokens.toLocaleString()) + ' tokens');
  console.log('  \u5de5\u5177\uff1a  ' + chalk.yellow(stats.toolCalls) + ' \u6b21\u8c03\u7528');
  console.log('  \u5408\u8ba1\uff1a  ' + chalk.yellow((stats.inputTokens + stats.outputTokens).toLocaleString()) + ' tokens');
  console.log('');
}

function estimateCost(stats) {
  // 价格表在 MODEL_PROVIDERS 中定义，此处动态查找
  // 价格单位：元/1000 tokens，仅供参考
  const p = findModelPrice(currentModel);
  const provider = findProvider(currentModel);
  const inputCost  = (stats.inputTokens  / 1000) * p.input;
  const outputCost = (stats.outputTokens / 1000) * p.output;
  const total = inputCost + outputCost;
  console.log('');
  console.log(chalk.bold.white(' 费用估算（仅供参考）：'));
  console.log('  模型：    ' + chalk.cyan(currentModel) + (provider ? chalk.gray(' (' + provider.name + ')') : ''));
  console.log('  输入：    ' + chalk.yellow(stats.inputTokens.toLocaleString()) + ' tokens × ¥' + p.input + '/K = ' + chalk.yellow('¥' + inputCost.toFixed(4)));
  console.log('  输出：    ' + chalk.yellow(stats.outputTokens.toLocaleString()) + ' tokens × ¥' + p.output + '/K = ' + chalk.yellow('¥' + outputCost.toFixed(4)));
  console.log('  合计：    ' + chalk.bold.yellow('¥' + total.toFixed(4)));
  if (p.input === 0 && p.output === 0) {
    console.log('  ' + chalk.gray('(' + currentModel + ' 免费模型，费用为零)'));
  }
  console.log('');
}

async function printStatus() {
  const apiBase = process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/';
  const hasKey = !!(process.env.OPENAI_API_KEY);
  console.log('');
  console.log(chalk.bold.white(' \u72b6\u6001\uff1a'));
  console.log('  \u7248\u672c\uff1a    ' + chalk.cyan('v' + VERSION));
  console.log('  \u6a21\u578b\uff1a    ' + chalk.cyan(currentModel));
  console.log('  API\uff1a     ' + chalk.gray(apiBase));
  console.log('  API Key\uff1a ' + (hasKey ? chalk.green('\u2713 \u5df2\u8bbe\u7f6e') : chalk.red('\u2717 \u672a\u8bbe\u7f6e')));
  console.log('  \u4f5c\u8005\uff1a    ' + chalk.white('OpenDemon'));
  console.log('  GitHub\uff1a  ' + chalk.blue.underline('https://github.com/OpenDemon/claude-ace'));
  console.log('');
}

async function runDoctor() {
  console.log('');
  console.log(chalk.bold.white(' \u73af\u5883\u68c0\u67e5\uff1a'));

  // Node version
  const nodeVer = process.version;
  const nodeMajor = parseInt(nodeVer.slice(1));
  console.log('  Node.js\uff1a   ' + (nodeMajor >= 18 ? chalk.green('\u2713 ' + nodeVer) : chalk.red('\u2717 ' + nodeVer + ' (\u9700\u8981 v18+)')));

  // API Key
  const hasKey = !!(process.env.OPENAI_API_KEY);
  console.log('  API Key\uff1a   ' + (hasKey ? chalk.green('\u2713 \u5df2\u8bbe\u7f6e') : chalk.red('\u2717 \u672a\u8bbe\u7f6e — \u8bf7\u8bbe\u7f6e OPENAI_API_KEY')));

  // Base URL
  const baseUrl = process.env.OPENAI_BASE_URL || '(default)';
  console.log('  Base URL：  ' + chalk.gray(baseUrl));

  // Model + 识别提供商
  const provider = findProvider(currentModel);
  const providerLabel = provider ? chalk.gray(' (' + provider.name + ')') : chalk.gray(' (自定义)');
  console.log('  模型：     ' + chalk.cyan(currentModel) + providerLabel);

  // 检查 Base URL 是否与模型匹配
  if (provider && process.env.OPENAI_BASE_URL) {
    const setBase = process.env.OPENAI_BASE_URL.replace(/\/$/, '');
    const expectBase = provider.envBase.replace(/\/$/, '');
    if (setBase !== expectBase) {
      console.log('  ' + chalk.yellow('⚠ Base URL 与模型提供商不匹配'));
      console.log('    ' + chalk.gray('建议设置：') + chalk.cyan(provider.envBase));
    } else {
      console.log('  ' + chalk.green('✓ Base URL 与模型提供商匹配'));
    }
  } else if (provider && !process.env.OPENAI_BASE_URL) {
    console.log('  ' + chalk.yellow('⚠ 未设置 OPENAI_BASE_URL，建议设置为：') + chalk.cyan(provider.envBase));
  }

  // tree-sitter
  try {
    const p = path.join(PROJECT_ROOT, 'node_modules', 'tree-sitter');
    const ok = fs.existsSync(p);
    console.log('  tree-sitter: ' + (ok ? chalk.green('✓ 已安装') : chalk.red('✗ 未安装 — 运行 npm install')));
  } catch (_) { console.log('  tree-sitter: ' + chalk.red('✗ 检查失败')); }

  // openai package
  try {
    const p = path.join(PROJECT_ROOT, 'node_modules', 'openai');
    const ok = fs.existsSync(p);
    console.log('  openai：     ' + (ok ? chalk.green('✓ 已安装') : chalk.red('✗ 未安装 — 运行 npm install')));
  } catch (_) {}

  // memory dir
  const memDir = path.join(os.homedir(), '.ace-memory');
  const memExists = fs.existsSync(memDir);
  console.log('  记忆目录：  ' + (memExists ? chalk.green('✓ ' + memDir) : chalk.gray('○ 尚未创建（首次使用 Memory 工具后自动创建）')));

  // session dir
  const sessDir = path.join(os.homedir(), '.claude-ace', 'sessions');
  const sessExists = fs.existsSync(sessDir);
  console.log('  会话目录：  ' + (sessExists ? chalk.green('✓ ' + sessDir) : chalk.gray('○ 尚未创建')));

  console.log('');

  // 配置帮助
  if (!hasKey) {
    console.log(chalk.yellow('  快速修复：'));
    console.log(chalk.gray('  Windows PowerShell:'));
    console.log(chalk.cyan('    $env:OPENAI_API_KEY="your-key"'));
    console.log(chalk.gray('  Mac/Linux:'));
    console.log(chalk.cyan('    export OPENAI_API_KEY="your-key"'));
    console.log('');
  }

  // 各提供商配置快速参考
  console.log(chalk.bold.white('  各提供商配置参考：'));
  const providerGuides = [
    { name: '智谱 GLM',        key: 'open.bigmodel.cn',   base: 'https://open.bigmodel.cn/api/paas/v4/',          model: 'glm-5-turbo' },
    { name: '通义千问 (Qwen)',  key: 'dashscope',        base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
    { name: 'DeepSeek',          key: 'deepseek',         base: 'https://api.deepseek.com/v1',                    model: 'deepseek-chat' },
    { name: 'MiniMax',           key: 'minimax',          base: 'https://api.minimax.chat/v1',                    model: 'MiniMax-Text-01' },
    { name: 'Kimi (Moonshot)',   key: 'moonshot',         base: 'https://api.moonshot.cn/v1',                     model: 'moonshot-v1-8k' },
    { name: 'OpenAI',            key: 'openai',           base: 'https://api.openai.com/v1',                      model: 'gpt-4o-mini' },
  ];
  for (const g of providerGuides) {
    const isCurrent = provider && provider.name === g.name;
    const prefix = isCurrent ? chalk.green('  ▶ ') : chalk.gray('    ');
    console.log(prefix + chalk.bold(g.name));
    console.log(chalk.gray('      OPENAI_BASE_URL=') + chalk.cyan(g.base));
    console.log(chalk.gray('      OPENAI_MODEL=') + chalk.cyan(g.model));
  }
  console.log('');
}

function printSkills() {
  console.log('');
  console.log(chalk.bold.white(' ACE \u5de5\u5177\u80fd\u529b\uff1a'));
  const skills = [
    ['FileRead',          '\u8bfb\u53d6\u6587\u4ef6\uff0c\u5927\u6587\u4ef6\u81ea\u52a8\u8fd4\u56de\u9aa8\u67b6\uff0c\u6309\u9700\u5c55\u5f00\u51fd\u6570'],
    ['FileWrite',         '\u5199\u5165\u6216\u8986\u76d6\u6587\u4ef6'],
    ['Bash',              '\u6267\u884c Shell \u547d\u4ee4\uff08ls\u3001node\u3001npm\u3001git \u7b49\uff09'],
    ['Grep',              '\u6b63\u5219\u641c\u7d22\u6587\u4ef6\u5185\u5bb9'],
    ['SemanticSearch',    'AST \u7ea7\u522b\u7b26\u53f7\u641c\u7d22\uff0c\u6bd4 Grep \u6548\u7387\u9ad8 10\u500d'],
    ['IntentVerify',      '\u610f\u56fe\u9a71\u52a8\u7684\u4ee3\u7801\u4fee\u6539 + \u81ea\u52a8\u6d4b\u8bd5\u9a8c\u8bc1\u95ed\u73af'],
    ['ExpandSymbol',      '\u6309\u9700\u5c55\u5f00\u51fd\u6570\u5b8c\u6574\u5b9e\u73b0\uff0c\u9632\u6b62\u5e7b\u89c9'],
    ['CriticalArchitect', '\u67b6\u6784\u5ba1\u67e5\uff1a\u5b89\u5168\u98ce\u9669\u3001\u6027\u80fd\u74f6\u9888\u3001\u53cd\u6a21\u5f0f\u5206\u6790'],
    ['Memory',            '\u8de8\u9879\u76ee\u8bb0\u5fc6\uff1a\u5b58\u50a8\u548c\u8c03\u53d6\u8c03\u8bd5\u7ecf\u9a8c'],
    ['CallGraph',         '\u8c03\u7528\u56fe\u5206\u6790\uff1a\u4fee\u6539\u51fd\u6570\u524d\u8bc4\u4f30\u5f71\u54cd\u8303\u56f4'],
  ];
  for (const [name, desc] of skills) {
    console.log('  ' + chalk.cyan(name.padEnd(18)) + chalk.gray(desc));
  }
  console.log('');
}

async function handleMemory(rl) {
  const mem = new CrossProjectMemory();
  const db = mem.getDB();
  const lessons = db.lessons || [];
  console.log('');
  if (lessons.length === 0) {
    console.log(chalk.gray('  \u8bb0\u5fc6\u5e93\u4e3a\u7a7a\u3002\u5f53 Agent \u89e3\u51b3\u96be\u9898\u540e\u4f1a\u81ea\u52a8\u5b66\u4e60\u3002'));
    console.log('');
    return;
  }
  console.log(chalk.bold.white(' \u8de8\u9879\u76ee\u8bb0\u5fc6\u5e93\uff08' + lessons.length + ' \u6761\uff09\uff1a'));
  lessons.forEach((l, i) => {
    const tags = (l.tags || []).join(', ');
    const time = SessionManager.relativeTime(l.timestamp);
    console.log('  ' + chalk.gray((i + 1) + '.') + ' ' + chalk.cyan('[' + tags + ']') + chalk.gray(' ' + time));
    console.log('     ' + chalk.white(l.description || '').slice(0, 80));
    if (l.solution) console.log('     ' + chalk.gray('\u89e3\u51b3\uff1a') + chalk.gray(l.solution.slice(0, 80)));
  });
  console.log('');

  rl.pause();
  try {
    const action = await select({
      message: '\u64cd\u4f5c',
      choices: [
        { name: '\u8fd4\u56de', value: 'back' },
        { name: '\u5220\u9664\u6761\u76ee\u2026', value: 'delete' },
        { name: '\u6e05\u7a7a\u6240\u6709\u8bb0\u5fc6', value: 'clear_all' },
      ],
      theme: { prefix: '', style: { highlight: (t) => chalk.bold.cyan(t) } }
    });

    if (action === 'delete' && lessons.length > 0) {
      const idx = await select({
        message: '\u9009\u62e9\u8981\u5220\u9664\u7684\u6761\u76ee',
        choices: lessons.map((l, i) => ({
          name: '[' + (l.tags || []).join(',') + '] ' + (l.description || '').slice(0, 50),
          value: i,
        })),
        theme: { prefix: '', style: { highlight: (t) => chalk.bold.cyan(t) } }
      });
      db.lessons.splice(idx, 1);
      mem.saveDB(db);
      console.log(chalk.gray('\n  \u5df2\u5220\u9664\u3002\n'));
    } else if (action === 'clear_all') {
      db.lessons = [];
      mem.saveDB(db);
      console.log(chalk.gray('\n  \u8bb0\u5fc6\u5e93\u5df2\u6e05\u7a7a\u3002\n'));
    }
  } catch (_) {}
  rl.resume();
}

async function handleWatchdog(watchdog, rl) {
  console.log('');
  console.log(chalk.bold.white(' Watchdog \u72b6\u6001\uff1a'));
  console.log('  \u8fd0\u884c\u4e2d\uff1a   ' + (watchdog.isRunning ? chalk.green('\u2713 \u662f') : chalk.gray('\u2717 \u5df2\u505c\u6b62')));
  console.log('  \u626b\u63cf\u95f4\u9694\uff1a ' + chalk.gray((watchdog.intervalMs / 60000).toFixed(0) + ' \u5206\u949f'));
  console.log('  \u65e5\u5fd7\u6587\u4ef6\uff1a ' + chalk.gray(watchdog.logFile));
  console.log('');

  rl.pause();
  try {
    const choices = [
      { name: '\u8fd4\u56de', value: 'back' },
    ];
    if (watchdog.isRunning) {
      choices.push({ name: '\u6682\u505c\u5b88\u62a4', value: 'stop' });
      choices.push({ name: '\u7acb\u5373\u626b\u63cf\u4e00\u6b21', value: 'scan' });
    } else {
      choices.push({ name: '\u542f\u52a8\u5b88\u62a4', value: 'start' });
    }
    choices.push({ name: '\u67e5\u770b\u65e5\u5fd7\uff08\u6700\u540e 20 \u884c\uff09', value: 'log' });

    const action = await select({
      message: '\u64cd\u4f5c',
      choices,
      theme: { prefix: '', style: { highlight: (t) => chalk.bold.cyan(t) } }
    });

    if (action === 'stop')  { watchdog.stop();  console.log(chalk.gray('\n  Watchdog \u5df2\u6682\u505c\u3002\n')); }
    if (action === 'start') { watchdog.start(); console.log(chalk.gray('\n  Watchdog \u5df2\u542f\u52a8\u3002\n')); }
    if (action === 'scan')  {
      console.log(chalk.gray('  \u6b63\u5728\u626b\u63cf\u2026'));
      await watchdog.scanAndHeal();
      console.log(chalk.gray('  \u626b\u63cf\u5b8c\u6210\u3002\n'));
    }
    if (action === 'log') {
      try {
        const logContent = fs.readFileSync(watchdog.logFile, 'utf-8');
        const lines = logContent.trim().split('\n').slice(-20);
        console.log('');
        lines.forEach(l => console.log(chalk.gray('  ' + l)));
        console.log('');
      } catch (_) {
        console.log(chalk.gray('\n  \u65e5\u5fd7\u6587\u4ef6\u4e0d\u5b58\u5728\u3002\n'));
      }
    }
  } catch (_) {}
  rl.resume();
}

async function handleCallGraph(args) {
  const filePath = args.trim();
  if (!filePath) {
    console.log(chalk.gray('\n  \u7528\u6cd5\uff1a/callgraph <\u6587\u4ef6\u8def\u5f84>\n  \u4f8b\uff1a/callgraph src/agent/Agent.js\n'));
    return;
  }
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    console.log(chalk.red('\n  \u6587\u4ef6\u4e0d\u5b58\u5728\uff1a' + absPath + '\n'));
    return;
  }
  console.log(chalk.gray('\n  \u5206\u6790\u4e2d\uff1a' + absPath + '\n'));
  try {
    const cgt = new CallGraphTool();
    const result = await cgt.execute({ query: 'full_graph', targetFile: absPath });
    console.log(chalk.white(result));
    console.log('');
  } catch (e) {
    console.log(chalk.red('  \u5206\u6790\u5931\u8d25\uff1a' + e.message + '\n'));
  }
}

// 模型提供商配置表
const MODEL_PROVIDERS = [
  {
    name: '智谱 GLM',
    envBase: 'https://open.bigmodel.cn/api/paas/v4/',
    apiUrl: 'https://open.bigmodel.cn/',
    models: [
      { id: 'glm-5-turbo',  desc: '推荐，龙虾套餐支持',   price: { input: 0.05,  output: 0.05  } },
      { id: 'glm-4-flash',  desc: '免费，适合日常任务',   price: { input: 0.0,   output: 0.0   } },
      { id: 'glm-4-plus',   desc: '付费，能力更强',         price: { input: 0.1,   output: 0.1   } },
      { id: 'glm-5',        desc: '付费，最强能力',         price: { input: 0.1,   output: 0.1   } },
    ],
  },
  {
    name: '通义千问 (Qwen)',
    envBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiUrl: 'https://bailian.console.aliyun.com/',
    models: [
      { id: 'qwen-turbo',   desc: '快速，适合日常任务',   price: { input: 0.02,  output: 0.06  } },
      { id: 'qwen-plus',    desc: '平衡性能与价格',       price: { input: 0.04,  output: 0.12  } },
      { id: 'qwen-max',     desc: '最强能力',               price: { input: 0.04,  output: 0.12  } },
      { id: 'qwen-coder-plus', desc: '代码优化版',            price: { input: 0.035, output: 0.105 } },
    ],
  },
  {
    name: 'DeepSeek',
    envBase: 'https://api.deepseek.com/v1',
    apiUrl: 'https://platform.deepseek.com/',
    models: [
      { id: 'deepseek-chat',      desc: '通用对话，性价比极高',   price: { input: 0.014, output: 0.028 } },
      { id: 'deepseek-reasoner',  desc: '深度推理（R1）',         price: { input: 0.04,  output: 0.16  } },
    ],
  },
  {
    name: 'MiniMax',
    envBase: 'https://api.minimax.chat/v1',
    apiUrl: 'https://platform.minimaxi.com/',
    models: [
      { id: 'MiniMax-Text-01',  desc: '旗舰模型，长文本处理',   price: { input: 0.1,   output: 0.1   } },
      { id: 'abab6.5s-chat',   desc: '快速响应，适合对话',   price: { input: 0.01,  output: 0.01  } },
    ],
  },
  {
    name: 'Kimi (Moonshot)',
    envBase: 'https://api.moonshot.cn/v1',
    apiUrl: 'https://platform.moonshot.cn/',
    models: [
      { id: 'moonshot-v1-8k',    desc: '8K 上下文，速度快',       price: { input: 0.012, output: 0.012 } },
      { id: 'moonshot-v1-32k',   desc: '32K 上下文，平衡',         price: { input: 0.024, output: 0.024 } },
      { id: 'moonshot-v1-128k',  desc: '128K 超长上下文',           price: { input: 0.06,  output: 0.06  } },
    ],
  },
  {
    name: 'OpenAI',
    envBase: 'https://api.openai.com/v1',
    apiUrl: 'https://platform.openai.com/',
    models: [
      { id: 'gpt-4.1-mini',  desc: '小模型，性价比高',         price: { input: 0.04,  output: 0.12  } },
      { id: 'gpt-4o',        desc: '旗舰多模态模型',           price: { input: 0.25,  output: 1.0   } },
      { id: 'gpt-4o-mini',   desc: '小型多模态，性价比高',   price: { input: 0.015, output: 0.06  } },
    ],
  },
];

// 根据模型 ID 查找提供商
function findProvider(modelId) {
  for (const p of MODEL_PROVIDERS) {
    if (p.models.find(m => m.id === modelId)) return p;
  }
  return null;
}

// 根据模型 ID 查找价格
function findModelPrice(modelId) {
  for (const p of MODEL_PROVIDERS) {
    const m = p.models.find(m => m.id === modelId);
    if (m) return m.price;
  }
  return { input: 0.05, output: 0.05 };
}

async function handleModel(args, rl) {
  const newModel = args.trim();
  if (!newModel) {
    // 无参数：展示分组模型列表
    console.log('');
    console.log(chalk.bold.white(' 当前模型：') + chalk.cyan(currentModel));
    console.log(chalk.gray('  切换：/model <模型名称>  例：/model deepseek-chat'));
    console.log('');
    for (const provider of MODEL_PROVIDERS) {
      console.log('  ' + chalk.bold.yellow(provider.name) + chalk.gray('  申请 Key：') + chalk.cyan(provider.apiUrl));
      for (const m of provider.models) {
        const cur = m.id === currentModel ? chalk.green(' ← 当前') : '';
        const priceStr = m.price.input === 0 ? chalk.green('免费') : chalk.gray('¥' + m.price.input + '/K入');
        console.log('    ' + chalk.cyan(m.id.padEnd(22)) + chalk.gray(m.desc.padEnd(16)) + priceStr + cur);
      }
      console.log('');
    }
    return;
  }

  // 有参数：切换模型 + 交互式向导
  const provider = findProvider(newModel);

  // 先切换模型
  currentModel = newModel;
  process.env.OPENAI_MODEL = newModel;

  console.log('');
  console.log(chalk.bold.white(' 模型已切换为：') + chalk.cyan(newModel) + (provider ? chalk.gray(' (' + provider.name + ')') : ''));

  if (!provider) {
    console.log(chalk.gray('  未识别的模型，请手动设置 OPENAI_BASE_URL 和 OPENAI_API_KEY。'));
    console.log('');
    return;
  }

  // 设置 Base URL
  process.env.OPENAI_BASE_URL = provider.envBase;
  console.log(chalk.gray('  Base URL 已自动设置：') + chalk.cyan(provider.envBase));

  // 直接加载该提供商已保存的 Key
  const savedKey = getProviderKey(provider.name);
  if (savedKey) {
    process.env.OPENAI_API_KEY = savedKey;
    const masked = savedKey.slice(0, 6) + '****' + savedKey.slice(-4);
    console.log(chalk.green('  ✓ 已加载 ' + provider.name + ' 的 Key：') + chalk.gray(masked));
  } else {
    // 该提供商还没配置过 Key
    console.log(chalk.yellow('  该提供商尚未配置 Key。'));
    console.log(chalk.gray('  申请地址：') + chalk.cyan(provider.apiUrl));
    console.log(chalk.gray('  运行 /setup 重新配置，或设置环境变量 OPENAI_API_KEY。'));
  }
  console.log('');
}

async function handleCompact(agent) {
  const msgs = agent.messages;
  const userMsgs = msgs.filter(m => m.role === 'user').length;
  if (userMsgs <= 2) {
    console.log(chalk.gray('\n  \u5bf9\u8bdd\u8fc7\u77ed\uff0c\u65e0\u9700\u538b\u7f29\u3002\n'));
    return;
  }
  // Keep system prompt + last 4 messages, summarize the rest
  const system = msgs.filter(m => m.role === 'system');
  const recent = msgs.filter(m => m.role !== 'system').slice(-4);
  const summarized = msgs.filter(m => m.role !== 'system').slice(0, -4);
  const summary = summarized.map(m => {
    const role = m.role === 'user' ? '\u7528\u6237' : 'ACE';
    const content = typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '');
    return role + ': ' + content.slice(0, 100);
  }).join('\n');

  const summaryMsg = {
    role: 'user',
    content: '[COMPACT] \u4ee5\u4e0b\u662f\u65e9\u671f\u5bf9\u8bdd\u7684\u6458\u8981\uff1a\n' + summary
  };
  const summaryReply = { role: 'assistant', content: '[COMPACT] \u5df2\u4e86\u89e3\u65e9\u671f\u5bf9\u8bdd\u5185\u5bb9\u3002' };

  agent.messages = [...system, summaryMsg, summaryReply, ...recent];
  const saved = msgs.length - agent.messages.length;
  console.log(chalk.gray('\n  \u5df2\u538b\u7f29\uff1a\u4fdd\u7559\u6700\u8fd1 4 \u6761\u6d88\u606f\uff0c\u538b\u7f29\u4e86 ' + saved + ' \u6761\u65e9\u671f\u6d88\u606f\u3002\n'));
}

function handleExport(agent, sm, sessionId) {
  const msgs = agent.messages.filter(m => m.role !== 'system');
  if (msgs.length === 0) {
    console.log(chalk.gray('\n  \u5bf9\u8bdd\u4e3a\u7a7a\uff0c\u65e0\u5185\u5bb9\u53ef\u5bfc\u51fa\u3002\n'));
    return;
  }
  const session = sm.load(sessionId);
  const title = session?.name || 'claude-ace-conversation';
  const filename = title.replace(/[^\w\u4e00-\u9fa5-]/g, '-').slice(0, 40) + '-' + Date.now() + '.md';
  const outPath = path.join(process.cwd(), filename);

  let md = '# ' + title + '\n\n';
  md += '> \u5bfc\u51fa\u65f6\u95f4\uff1a' + new Date().toLocaleString('zh-CN') + '  \n';
  md += '> \u6a21\u578b\uff1a' + currentModel + '  \n';
  md += '> \u5de5\u5177\uff1a Claude-ACE v' + VERSION + '\n\n---\n\n';

  for (const m of msgs) {
    const role = m.role === 'user' ? '## \u7528\u6237' : '## Claude-ACE';
    const content = typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '');
    md += role + '\n\n' + content + '\n\n---\n\n';
  }

  fs.writeFileSync(outPath, md);
  console.log(chalk.gray('\n  \u5df2\u5bfc\u51fa\u5230\uff1a') + chalk.white(outPath) + '\n');
}

function handleInit() {
  const configPath = path.join(process.cwd(), '.claude-ace.json');
  if (fs.existsSync(configPath)) {
    console.log(chalk.gray('\n  .claude-ace.json \u5df2\u5b58\u5728\uff1a' + configPath + '\n'));
    return;
  }
  const config = {
    model: currentModel,
    skeletonThreshold: 200,
    watchdog: { enabled: true, intervalMinutes: 5 },
    memory: { qualityGate: true },
    version: VERSION,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(chalk.gray('\n  \u5df2\u521b\u5efa\uff1a') + chalk.white(configPath));
  console.log(chalk.gray('  \u53ef\u4ee5\u7f16\u8f91\u6b64\u6587\u4ef6\u6765\u8c03\u6574 Claude-ACE \u7684\u884c\u4e3a\u3002\n'));
}

function printReleaseNotes() {
  console.log(renderMarkdown(RELEASE_NOTES));
}

// ─── Setup Wizard ─────────────────────────────────────────────────────────────────────────
async function runSetupWizard(rl) {
  const rlAsk = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  console.log('');
  console.log(chalk.bold.cyan(' ✨ 首次运行配置向导'));
  console.log(chalk.gray(' 请为想使用的提供商填写 API Key，直接回车可跳过。'));
  console.log(chalk.gray(' Key 将保存到 ~/.ace-keys.json，下次启动无需重新输入。'));
  console.log('');

  for (const provider of MODEL_PROVIDERS) {
    const savedKey = getProviderKey(provider.name);
    const modelList = provider.models.map(m => m.id).join('、');

    console.log(chalk.bold.yellow('  ' + provider.name));
    console.log(chalk.gray('  模型：') + chalk.cyan(modelList));
    console.log(chalk.gray('  申请 Key：') + chalk.cyan(provider.apiUrl));

    if (savedKey) {
      const masked = savedKey.slice(0, 6) + '****' + savedKey.slice(-4);
      process.stdout.write(chalk.gray('  已保存 Key：' + masked + '，直接回车保留，或输入新 Key：'));
    } else {
      process.stdout.write(chalk.gray('  输入 API Key（回车跳过）：'));
    }

    const raw = await rlAsk('');
    const trimmed = raw.trim();

    if (trimmed.length >= 8) {
      saveProviderKey(provider.name, trimmed);
      console.log(chalk.green('  ✓ 已保存'));
    } else if (trimmed.length > 0) {
      console.log(chalk.yellow('  Key 过短，已跳过。'));
    } else if (savedKey) {
      console.log(chalk.gray('  保留旧 Key。'));
    } else {
      console.log(chalk.gray('  已跳过。'));
    }
    console.log('');
  }

  // 设置默认模型：选择第一个有 Key 的提供商
  for (const provider of MODEL_PROVIDERS) {
    const key = getProviderKey(provider.name);
    if (key) {
      currentModel = provider.models[0].id;
      process.env.OPENAI_MODEL = currentModel;
      process.env.OPENAI_API_KEY = key;
      process.env.OPENAI_BASE_URL = provider.envBase;
      console.log(chalk.gray(' 默认模型设为：') + chalk.cyan(currentModel) + chalk.gray(' (' + provider.name + ')'));
      break;
    }
  }

  console.log(chalk.green(' ✓ 配置完成！使用 /model <模型名> 随时切换。'));
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────────
async function main() {
  const sm = new SessionManager();
  const sessions = sm.list(10);

  printBanner(sessions);

  const trusted = await confirmTrust();
  if (!trusted) {
    console.log(chalk.gray('\n \u5df2\u9000\u51fa\u3002\n'));
    process.exit(0);
  }

  console.log('');
  console.log(chalk.bold.cyan(' 欢迎使用 Claude-ACE'));
  console.log('');

  // 创建 rl 实例（向导和主循环共用）
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 200,
  });

  // 检测是否首次运行（没有任何已保存的 Key）
  const existingKeys = loadProviderKeys();
  const hasAnyKey = Object.keys(existingKeys).length > 0;
  if (!hasAnyKey) {
    await runSetupWizard(rl);
  } else {
    // 自动加载当前模型对应提供商的 Key
    const provider = findProvider(currentModel);
    if (provider) {
      const savedKey = getProviderKey(provider.name);
      if (savedKey) {
        process.env.OPENAI_API_KEY = savedKey;
        process.env.OPENAI_BASE_URL = provider.envBase;
      }
    }
  }

  // ─── Worker Thread 架构 ───────────────────────────────────────────────────
  // Agent 在独立 Worker Thread 中运行，主线程的 readline 始终保持响应。
  // 用户可以在 Agent 执行期间输入新指令（Ctrl+C 取消，或等待完成后继续）。

  const WORKER_PATH = path.join(__dirname, 'agent', 'AgentWorker.js');
  const agentWorker = new Worker(WORKER_PATH, {
    workerData: {
      env: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '',
        OPENAI_MODEL: process.env.OPENAI_MODEL || 'glm-5-turbo'
      }
    }
  });

  // 主线程持有的消息历史副本（与 Worker 双向同步）
  let sharedMessages = [];
  let sharedStats = { inputTokens: 0, outputTokens: 0, toolCalls: 0 };

  // 兼容旧代码：提供 agent-like 接口供 handleCommand 使用
  const agent = {
    get messages() { return sharedMessages; },
    set messages(v) { sharedMessages = v; },
    get stats() { return sharedStats; },
    resetStats() { sharedStats = { inputTokens: 0, outputTokens: 0, toolCalls: 0 }; }
  };

  const watchdog = new WatchdogAgent(PROJECT_ROOT, { intervalMs: 300000 });
  watchdog.start();

  let sessionId = sm.create(process.cwd());
  let rewindStack = [];

  // Worker 是否正在执行任务
  let workerBusy = false;

  // isTTY 保护
  const isTTY = !!process.stdout.isTTY;

  // ─── Worker 消息处理 ────────────────────────────────────────────────────────
  let streamedText = '';
  let toolCount = 0;
  let toolLineActive = false;

  const clearToolLine = () => {
    if (toolLineActive && isTTY) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      toolLineActive = false;
    } else {
      toolLineActive = false;
    }
  };

  // 每次新任务开始时重置渲染状态
  const resetRenderState = () => {
    streamedText = '';
    toolCount = 0;
    toolLineActive = false;
  };

  agentWorker.on('message', (msg) => {
    if (msg.type === 'token') {
      clearToolLine();
      if (streamedText === '') {
        if (isTTY) {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
        }
        process.stdout.write(chalk.bold.cyan(' \u25cf ACE') + chalk.gray(' \u203a '));
      }
      streamedText += msg.token;
      process.stdout.write(msg.token);

    } else if (msg.type === 'toolStart') {
      toolCount++;
      clearToolLine();
      if (streamedText && !streamedText.endsWith('\n')) {
        process.stdout.write('\n');
        streamedText = '';
      }
      const d = TOOL_DISPLAY[msg.name] || { label: msg.name };
      const hint = formatArgHint(msg.name, msg.args);
      process.stdout.write(chalk.gray(` \u25b6 ${d.label}`) + hint);
      toolLineActive = true;

    } else if (msg.type === 'toolEnd') {
      clearToolLine();
      process.stdout.write(chalk.bold.cyan(' \u25cf ACE') + chalk.gray(' \u203a '));
      streamedText = '';

    } else if (msg.type === 'done') {
      clearToolLine();
      workerBusy = false;

      // 同步消息历史和统计
      if (msg.messages) sharedMessages = msg.messages;
      if (msg.stats) sharedStats = msg.stats;

      // 注意：流式 token 已经实时打印完毕，这里不再重新渲染，只补充换行和统计
      console.log('');
      if (toolCount > 0) {
        const s = sharedStats;
        console.log(chalk.gray(` [${toolCount} \u6b21\u5de5\u5177\u8c03\u7528 \u00b7 \u7d2f\u8ba1\u8f93\u5165 ${s.inputTokens.toLocaleString()} tokens]`));
      }
      console.log('');

      sm.save(sessionId, sharedMessages, sharedStats);
      // 恢复提示符
      process.stdout.write(chalk.bold.green('\u276f '));

    } else if (msg.type === 'aborted') {
      clearToolLine();
      workerBusy = false;
      console.log('');
      console.log(chalk.yellow(' 已取消当前任务。'));
      console.log('');
      process.stdout.write(chalk.bold.green('\u276f '));

    } else if (msg.type === 'error') {
      clearToolLine();
      workerBusy = false;
      console.log('');

      const errMsg = msg.message || '';
      const isAuthError = errMsg.includes('401') || errMsg.includes('Authentication') ||
                          errMsg.includes('Unauthorized') || errMsg.includes('invalid') ||
                          errMsg.includes('api key') || errMsg.includes('API key');
      const isModelError = errMsg.includes('model') || errMsg.includes('400') ||
                           errMsg.includes('not found');

      console.log(chalk.red(` [\u9519\u8bef] ${errMsg}`));

      if (isAuthError) {
        const provider = findProvider(currentModel);
        console.log(chalk.yellow('\n  API Key \u65e0\u6548\u6216\u5df2\u8fc7\u671f\u3002'));
        if (provider) {
          console.log(chalk.gray('  \u5f53\u524d\u6a21\u578b\uff1a') + chalk.cyan(currentModel) + chalk.gray(' (' + provider.name + ')'));
          console.log(chalk.gray('  \u7533\u8bf7 / \u67e5\u770b Key\uff1a') + chalk.bold.cyan(provider.apiUrl));
        }
        console.log(chalk.gray('  \u8f93\u5165 /model ' + currentModel + ' \u91cd\u65b0\u8bbe\u7f6e Key'));
      } else if (isModelError) {
        console.log(chalk.gray(' \u63d0\u793a\uff1a\u8bf7\u68c0\u67e5\u6a21\u578b\u540d\u79f0\u662f\u5426\u6b63\u786e\u3002\u5f53\u524d\u6a21\u578b\uff1a' + currentModel));
        console.log(chalk.gray(' \u8f93\u5165 /model \u67e5\u770b\u53ef\u7528\u6a21\u578b\u5217\u8868'));
      }
      console.log('');
      process.stdout.write(chalk.bold.green('\u276f '));
    }
  });

  agentWorker.on('error', (err) => {
    workerBusy = false;
    console.error(chalk.red('\n [Worker 错误] ' + err.message));
    process.stdout.write(chalk.bold.green('\u276f '));
  });

  // ─── SIGINT 处理 ────────────────────────────────────────────────────────────
  process.on('SIGINT', () => {
    if (workerBusy) {
      // Agent 正在运行：发送取消消息，不退出
      agentWorker.postMessage({ type: 'cancel' });
    } else {
      // 空闲状态：退出程序
      sm.save(sessionId, sharedMessages, sharedStats);
      console.log('\n' + chalk.gray(' 再见！') + '\n');
      watchdog.stop();
      agentWorker.terminate();
      process.exit(0);
    }
  });

  // ─── 主输入循环（始终响应，不被 Agent 阻塞）────────────────────────────────
  // 用事件驱动替代 rl.question，避免 readline 占用 stdout 导致 Worker 输出被干扰
  const lineQueue = [];
  let lineResolve = null;

  rl.on('line', (line) => {
    if (lineResolve) {
      const res = lineResolve;
      lineResolve = null;
      res(line);
    } else {
      lineQueue.push(line);
    }
  });

  rl.on('close', () => {
    if (lineResolve) lineResolve(null);
  });

  const askLine = () => new Promise((resolve) => {
    if (lineQueue.length > 0) {
      resolve(lineQueue.shift());
    } else {
      lineResolve = resolve;
    }
  });

  // 显示初始提示符
  process.stdout.write(chalk.bold.green('\u276f '));

  while (true) {
    let userInput;
    try { userInput = await askLine(); } catch (_) { break; }
    if (userInput === null) break; // rl 已关闭

    const trimmed = userInput.trim();

    if (trimmed === '/') {
      rl.pause();
      const cmd = await showSlashMenu();
      rl.resume();
      if (!cmd) {
        process.stdout.write(chalk.bold.green('\u276f '));
        continue;
      }
      await handleCommand(cmd, '', agent, sm, sessionId, rl, watchdog, rewindStack);
      // 同步 Worker 的环境变量（/model 可能改变了 Key/URL）
      agentWorker.postMessage({
        type: 'syncEnv',
        env: {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
          OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '',
          OPENAI_MODEL: process.env.OPENAI_MODEL || currentModel
        }
      });
      process.stdout.write(chalk.bold.green('\u276f '));
      continue;
    }

    if (trimmed.startsWith('/')) {
      const spaceIdx = trimmed.indexOf(' ');
      const base = spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed;
      const args = spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1) : '';
      await handleCommand(base, args, agent, sm, sessionId, rl, watchdog, rewindStack);
      // 同步 Worker 的环境变量
      agentWorker.postMessage({
        type: 'syncEnv',
        env: {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
          OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '',
          OPENAI_MODEL: process.env.OPENAI_MODEL || currentModel
        }
      });
      process.stdout.write(chalk.bold.green('\u276f '));
      continue;
    }

    if (!trimmed) {
      process.stdout.write(chalk.bold.green('\u276f '));
      continue;
    }

    // 如果 Worker 正忙，提示用户
    if (workerBusy) {
      console.log(chalk.yellow(' ACE 正在执行任务，按 Ctrl+C 取消，或等待完成后继续。'));
      process.stdout.write(chalk.bold.green('\u276f '));
      continue;
    }

    rewindStack.push(JSON.parse(JSON.stringify(sharedMessages)));
    if (rewindStack.length > 20) rewindStack.shift();

    resetRenderState();
    workerBusy = true;

    console.log('');
    process.stdout.write(chalk.bold.cyan(' \u25cf ACE') + chalk.gray(' \u203a '));

    // 发送任务给 Worker Thread
    agentWorker.postMessage({
      type: 'chat',
      message: trimmed,
      messages: JSON.parse(JSON.stringify(sharedMessages)),
      env: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '',
        OPENAI_MODEL: process.env.OPENAI_MODEL || currentModel
      }
    });
    // 注意：不 await，主循环继续响应输入
  }
}

async function handleCommand(base, args, agent, sm, sessionId, rl, watchdog, rewindStack) {
  if (base === '/exit' || base === '/quit') {
    sm.save(sessionId, agent.messages, agent.stats);
    console.log(chalk.gray('\n \u518d\u89c1\uff01\n'));
    watchdog.stop();
    rl.close();
    process.exit(0);
  }

  if (base === '/help')          { printHelp(); return; }
  if (base === '/stats')         { printStats(agent.stats); return; }
  if (base === '/cost')          { estimateCost(agent.stats); return; }
  if (base === '/status')        { await printStatus(); return; }
  if (base === '/doctor')        { await runDoctor(); return; }
  if (base === '/skills')        { printSkills(); return; }
  if (base === '/release-notes') { printReleaseNotes(); return; }
  if (base === '/memory')        { await handleMemory(rl); return; }
  if (base === '/watchdog')      { await handleWatchdog(watchdog, rl); return; }
  if (base === '/callgraph')     { await handleCallGraph(args); return; }
  if (base === '/model')         { await handleModel(args, rl); return; }
  if (base === '/setup')         { await runSetupWizard(rl); return; }
  if (base === '/compact')       { await handleCompact(agent); return; }
  if (base === '/export')        { handleExport(agent, sm, sessionId); return; }
  if (base === '/init')          { handleInit(); return; }

  if (base === '/clear') {
    agent.messages = agent.messages.slice(0, 1);
    agent.stats = { inputTokens: 0, outputTokens: 0, toolCalls: 0 };
    rewindStack.length = 0;
    console.log(chalk.gray('\n \u5bf9\u8bdd\u5386\u53f2\u5df2\u6e05\u7a7a\u3002\n'));
    return;
  }

  if (base === '/rewind') {
    if (rewindStack.length === 0) {
      console.log(chalk.gray('\n \u65e0\u53ef\u56de\u9000\u7684\u5386\u53f2\u3002\n'));
      return;
    }
    agent.messages = rewindStack.pop();
    console.log(chalk.gray('\n \u5df2\u56de\u9000\u5230\u4e0a\u4e00\u6761\u6d88\u606f\u4e4b\u524d\u7684\u72b6\u6001\u3002\n'));
    return;
  }

  if (base === '/rename') {
    rl.pause();
    try {
      const newName = await input({
        message: '\u65b0\u540d\u79f0\uff1a',
        theme: { prefix: chalk.gray('\u276f') }
      });
      if (newName.trim()) {
        sm.rename(sessionId, newName.trim());
        console.log(chalk.gray(`\n \u5bf9\u8bdd\u5df2\u91cd\u547d\u540d\u4e3a\u300c${newName.trim()}\u300d\u3002\n`));
      }
    } catch (_) {}
    rl.resume();
    return;
  }

  if (base === '/resume') {
    const sessions = sm.list(20);
    if (sessions.length === 0) {
      console.log(chalk.gray('\n \u6682\u65e0\u5386\u53f2\u5bf9\u8bdd\u3002\n'));
      return;
    }
    rl.pause();
    try {
      const chosen = await select({
        message: '\u9009\u62e9\u8981\u6062\u590d\u7684\u5bf9\u8bdd',
        choices: sessions.map(s => ({
          name: chalk.gray(SessionManager.relativeTime(s.updatedAt).padEnd(10)) + ' ' + chalk.white((s.name || '').slice(0, 50)),
          value: s.id,
          short: s.name || s.id,
        })),
        theme: { prefix: '', style: { highlight: (t) => chalk.bold.cyan(t) } }
      });
      const loaded = sm.load(chosen);
      if (loaded) {
        agent.messages = loaded.messages;
        agent.stats = loaded.stats || { inputTokens: 0, outputTokens: 0, toolCalls: 0 };
        sessionId = loaded.id;
        rewindStack.length = 0;
        console.log(chalk.gray(`\n \u5df2\u6062\u590d\u5bf9\u8bdd\u300c${loaded.name}\u300d\uff0c\u5171 ${loaded.messages.length - 1} \u6761\u6d88\u606f\u3002\n`));
      }
    } catch (_) {}
    rl.resume();
    return;
  }

  console.log(chalk.gray(`\n \u672a\u77e5\u547d\u4ee4\uff1a${base}\uff0c\u8f93\u5165 /help \u67e5\u770b\u5e2e\u52a9\u3002\n`));
}

main().catch(console.error);
