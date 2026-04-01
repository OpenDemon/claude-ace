/**
 * index.js — Interactive REPL entry point
 * Author: OpenDemon
 */
import readline from 'readline';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import { Agent } from './agent/Agent.js';
import { WatchdogAgent } from './watchdog/WatchdogAgent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const agent = new Agent();

// Start the background watchdog daemon (non-blocking)
const watchdog = new WatchdogAgent(PROJECT_ROOT, { intervalMs: 60000 });
watchdog.start();

// Graceful shutdown
process.on('SIGINT', () => {
  watchdog.stop();
  rl.close();
  process.exit(0);
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log(chalk.cyan('\n╔══════════════════════════════════════════╗'));
console.log(chalk.cyan('║  ACE-Coder — Adaptive Context AI Agent  ║'));
console.log(chalk.cyan('║  Author: OpenDemon                       ║'));
console.log(chalk.cyan('╚══════════════════════════════════════════╝'));
console.log(chalk.gray('Type your coding question. Ctrl+C to exit.\n'));

const prompt = () => {
  rl.question(chalk.green('You > '), async (input) => {
    if (!input.trim()) { prompt(); return; }

    process.stdout.write(chalk.yellow('ACE > '));
    try {
      const { answer, stats } = await agent.chat(input);
      console.log(answer);
      console.log(chalk.gray(`\n[Stats] Input: ${stats.inputTokens} tokens | Output: ${stats.outputTokens} tokens | Tool calls: ${stats.toolCalls}\n`));
    } catch (e) {
      console.log(chalk.red(`[Error] ${e.message}`));
    }
    prompt();
  });
};

prompt();
