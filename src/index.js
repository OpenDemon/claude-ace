/**
 * index.js — Claude-ACE Interactive CLI
 * Author: OpenDemon
 *
 * v0.5.0: Claude Code style CLI
 *   - ASCII logo with version info
 *   - Trust confirmation menu on startup
 *   - ❯ prompt style
 *   - / triggers interactive command picker (up/down to select)
 *   - Streaming output with typewriter effect
 *   - Markdown rendering with code syntax highlighting
 *   - Real-time tool call progress display
 */
import readline from 'readline';
import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { select } from '@inquirer/prompts';
import { Agent } from './agent/Agent.js';
import { WatchdogAgent } from './watchdog/WatchdogAgent.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const VERSION = '0.5.0';
const MODEL = process.env.OPENAI_MODEL || 'glm-5-turbo';

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
  FileRead:          { icon: '\u25b6', label: 'Reading' },
  FileWrite:         { icon: '\u25b6', label: 'Writing' },
  Bash:              { icon: '\u25b6', label: 'Running' },
  Grep:              { icon: '\u25b6', label: 'Searching' },
  SemanticSearch:    { icon: '\u25b6', label: 'Semantic search' },
  IntentVerify:      { icon: '\u25b6', label: 'Verifying' },
  ExpandSymbol:      { icon: '\u25b6', label: 'Expanding' },
  CriticalArchitect: { icon: '\u25b6', label: 'Architecture review' },
  Memory:            { icon: '\u25b6', label: 'Memory' },
  CallGraph:         { icon: '\u25b6', label: 'Call graph' },
};

function formatArgHint(name, args) {
  if (!args) return '';
  const val = args.path || args.targetFile || args.query || args.command || args.intent || args.action || '';
  if (!val) return '';
  const s = String(val);
  return chalk.gray(' ' + (s.length > 55 ? s.slice(0, 52) + '...' : s));
}

// ─── ASCII Banner (Claude Code style) ────────────────────────────────────────
function printBanner() {
  const cwd = process.cwd();
  console.log('');
  console.log(chalk.bold.cyan('\u258c\u2580\u2588\u2588\u2588\u2584\u2590\u2588   ') + chalk.bold.white('Claude-ACE') + chalk.gray(' v' + VERSION));
  console.log(chalk.bold.cyan('\u2580\u2584\u2588\u2588\u2588\u2588\u2588\u2580\u2588\u2580  ') + chalk.gray('GitHub: OpenDemon'));
  console.log(chalk.bold.cyan('  \u2598\u2598 \u259d\u259d    ') + chalk.gray(cwd));;
  console.log('');
}

// ─── Trust confirmation (Claude Code style) ──────────────────────────────────
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
      theme: {
        prefix: '',
        style: {
          highlight: (text) => chalk.bold.cyan(text),
        }
      }
    });
    return answer === 'yes';
  } catch (_) {
    return false;
  }
}

// ─── Slash command menu ───────────────────────────────────────────────────────
const SLASH_COMMANDS = [
  { name: '/help   \u663e\u793a\u5e2e\u52a9\u4fe1\u606f', value: '/help', short: '/help' },
  { name: '/clear  \u6e05\u7a7a\u5bf9\u8bdd\u5386\u53f2', value: '/clear', short: '/clear' },
  { name: '/stats  \u663e\u793a Token \u7edf\u8ba1', value: '/stats', short: '/stats' },
  { name: '/model  \u663e\u793a\u5f53\u524d\u6a21\u578b\u4fe1\u606f', value: '/model', short: '/model' },
  { name: '/exit   \u9000\u51fa\u7a0b\u5e8f', value: '/exit', short: '/exit' },
];

async function showSlashMenu() {
  try {
    const cmd = await select({
      message: '\u547d\u4ee4',
      choices: SLASH_COMMANDS,
      theme: {
        prefix: chalk.gray('/'),
        style: {
          highlight: (text) => chalk.bold.cyan(text),
        }
      }
    });
    return cmd;
  } catch (_) {
    return null;
  }
}

// ─── Help & stats ─────────────────────────────────────────────────────────────
function printHelp() {
  console.log('');
  console.log(chalk.bold.white(' \u547d\u4ee4\uff1a'));
  console.log(' ' + chalk.cyan('/help ') + '  \u663e\u793a\u6b64\u5e2e\u52a9');
  console.log(' ' + chalk.cyan('/clear') + '  \u6e05\u7a7a\u5bf9\u8bdd\u5386\u53f2');
  console.log(' ' + chalk.cyan('/stats') + '  \u663e\u793a Token \u7edf\u8ba1');
  console.log(' ' + chalk.cyan('/model') + '  \u663e\u793a\u5f53\u524d\u6a21\u578b\u4fe1\u606f');
  console.log(' ' + chalk.cyan('/exit ') + '  \u9000\u51fa\u7a0b\u5e8f');
  console.log('');
  console.log(chalk.gray(' \u8f93\u5165 / \u53ef\u5f39\u51fa\u547d\u4ee4\u83dc\u5355\uff0c\u4e0a\u4e0b\u7bad\u5934\u5207\u6362\u3002'));
  console.log('');
}

function printStats(stats) {
  console.log('');
  console.log(chalk.bold.white(' Token \u7edf\u8ba1\uff1a'));
  console.log(' \u8f93\u5165\uff1a  ' + chalk.yellow(stats.inputTokens.toLocaleString()));
  console.log(' \u8f93\u51fa\uff1a  ' + chalk.yellow(stats.outputTokens.toLocaleString()));
  console.log(' \u5de5\u5177\uff1a  ' + chalk.yellow(stats.toolCalls) + ' \u6b21\u8c03\u7528');
  console.log('');
}

function printModel() {
  console.log('');
  console.log(chalk.bold.white(' \u5f53\u524d\u6a21\u578b\uff1a'));
  console.log(' ' + chalk.cyan(MODEL));
  console.log(' API: ' + chalk.gray(process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/'));
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  printBanner();

  // Trust confirmation
  const trusted = await confirmTrust();
  if (!trusted) {
    console.log(chalk.gray('\n \u5df2\u9000\u51fa\u3002\n'));
    process.exit(0);
  }

  console.log('');
  console.log(chalk.bold.cyan(' \u6b22\u8fce\u4f7f\u7528 Claude-ACE'));
  console.log('');

  const agent = new Agent();

  // Start Watchdog silently (5 min interval)
  const watchdog = new WatchdogAgent(PROJECT_ROOT, { intervalMs: 300000 });
  watchdog.start();

  process.on('SIGINT', () => {
    console.log('\n' + chalk.gray(' \u518d\u89c1\uff01') + '\n');
    watchdog.stop();
    process.exit(0);
  });

  // ─── REPL loop ───────────────────────────────────────────────────────────────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 200,
  });

  const askLine = () => new Promise((resolve) => {
    rl.question(chalk.bold.green('\u276f '), resolve);
  });

  while (true) {
    let userInput;
    try {
      userInput = await askLine();
    } catch (_) { break; }

    const trimmed = userInput.trim();

    // Slash triggers menu
    if (trimmed === '/') {
      rl.pause();
      const cmd = await showSlashMenu();
      rl.resume();
      if (!cmd) continue;
      if (cmd === '/exit') {
        console.log(chalk.gray('\n \u518d\u89c1\uff01\n'));
        watchdog.stop();
        rl.close();
        process.exit(0);
      }
      if (cmd === '/help')  { printHelp();             continue; }
      if (cmd === '/stats') { printStats(agent.stats); continue; }
      if (cmd === '/model') { printModel();             continue; }
      if (cmd === '/clear') {
        agent.messages = agent.messages.slice(0, 1);
        agent.resetStats?.();
        console.log(chalk.gray('\n \u5bf9\u8bdd\u5386\u53f2\u5df2\u6e05\u7a7a\u3002\n'));
        continue;
      }
      continue;
    }

    // Direct slash commands (typed in full)
    if (trimmed === '/exit' || trimmed === '/quit') {
      console.log(chalk.gray('\n \u518d\u89c1\uff01\n'));
      watchdog.stop();
      rl.close();
      process.exit(0);
    }
    if (trimmed === '/help')  { printHelp();             continue; }
    if (trimmed === '/stats') { printStats(agent.stats); continue; }
    if (trimmed === '/model') { printModel();             continue; }
    if (trimmed === '/clear') {
      agent.messages = agent.messages.slice(0, 1);
      agent.resetStats?.();
      console.log(chalk.gray('\n \u5bf9\u8bdd\u5386\u53f2\u5df2\u6e05\u7a7a\u3002\n'));
      continue;
    }
    if (!trimmed) continue;

    // ── Stream response ─────────────────────────────────────────────────────
    console.log('');

    let streamedText = '';
    let toolCount = 0;
    let toolLineActive = false;

    const clearToolLine = () => {
      if (toolLineActive) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        toolLineActive = false;
      }
    };

    // Print ACE prefix
    process.stdout.write(chalk.bold.cyan(' \u25cf ACE') + chalk.gray(' \u203a '));

    try {
      await agent.chat(trimmed, {
        onToken: (token) => {
          clearToolLine();
          if (streamedText === '') {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(chalk.bold.cyan(' \u25cf ACE') + chalk.gray(' \u203a '));
          }
          streamedText += token;
          process.stdout.write(token);
        },
        onToolStart: ({ name, args }) => {
          toolCount++;
          clearToolLine();
          if (streamedText && !streamedText.endsWith('\n')) {
            process.stdout.write('\n');
            streamedText = '';
          }
          const d = TOOL_DISPLAY[name] || { icon: '\u25b6', label: name };
          const hint = formatArgHint(name, args);
          process.stdout.write(chalk.gray(` ${d.icon} ${d.label}`) + hint);
          toolLineActive = true;
        },
        onToolEnd: () => {
          clearToolLine();
          process.stdout.write(chalk.bold.cyan(' \u25cf ACE') + chalk.gray(' \u203a '));
          streamedText = '';
        }
      });

      clearToolLine();

      // Re-render final answer as Markdown
      if (streamedText) {
        const rawLines = streamedText.split('\n').length;
        for (let i = 0; i < rawLines; i++) {
          readline.clearLine(process.stdout, 0);
          if (i < rawLines - 1) readline.moveCursor(process.stdout, 0, -1);
        }
        readline.cursorTo(process.stdout, 0);

        const rendered = renderMarkdown(streamedText);
        const indented = rendered.split('\n').map(l => ' ' + l).join('\n');
        process.stdout.write(chalk.bold.cyan('\u25cf ACE') + chalk.gray(' \u203a ') + indented);
      }

      console.log('');
      if (toolCount > 0) {
        const s = agent.stats;
        console.log(chalk.gray(` [${toolCount} \u6b21\u5de5\u5177\u8c03\u7528 \u00b7 \u7d2f\u8ba1\u8f93\u5165 ${s.inputTokens.toLocaleString()} tokens]`));
      }
      console.log('');

    } catch (err) {
      clearToolLine();
      console.log('');
      console.log(chalk.red(` [\u9519\u8bef] ${err.message}`));
      if (err.message.includes('model') || err.message.includes('API') || err.message.includes('400')) {
        console.log(chalk.gray(' \u63d0\u793a\uff1a\u8bf7\u68c0\u67e5 OPENAI_API_KEY \u548c\u6a21\u578b\u540d\u79f0\u662f\u5426\u6b63\u786e\u3002'));
        console.log(chalk.gray(' \u5f53\u524d\u6a21\u578b\uff1a' + MODEL));
      }
      console.log('');
    }
  }
}

main().catch(console.error);
