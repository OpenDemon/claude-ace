/**
 * bench_glm.js — Token 节约效果实测（适配智谱 GLM 模型）
 * Author: OpenDemon
 *
 * 对比 ACE 模式 vs 原始模式（直接读全文）在真实代码任务上的 Token 消耗差异。
 * 使用智谱 GLM API（OpenAI 兼容接口）。
 */
import OpenAI from 'openai';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 配置 ─────────────────────────────────────────────────────────────────────
const MODEL = process.env.OPENAI_MODEL || 'glm-4-flash';
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: BASE_URL
});

console.log(chalk.gray(`  使用模型: ${MODEL}`));
console.log(chalk.gray(`  API 地址: ${BASE_URL}\n`));

// ─── 测试用的代码文件（使用项目自身代码，无需外部依赖）─────────────────────────
const SRC_DIR = path.resolve(__dirname, '../src');
const AGENT_FILE = path.join(SRC_DIR, 'agent/Agent.js');
const INTENT_FILE = path.join(SRC_DIR, 'tools/IntentVerificationTool.js');
const WATCHDOG_FILE = path.join(SRC_DIR, 'watchdog/WatchdogAgent.js');

// ─── 工具定义 ─────────────────────────────────────────────────────────────────

/** 原始模式：直接返回文件全文 */
function baselineReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    return `[Error] ${e.message}`;
  }
}

/** ACE 模式：返回骨架（只有函数签名，不含函数体） */
function aceReadFileSkeleton(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const skeleton = [];
    let inFunction = false;
    let braceDepth = 0;
    let skippedLines = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 函数/方法签名行
      const isFuncStart = /^(export\s+)?(async\s+)?function\s+\w+/.test(trimmed) ||
                          /^(async\s+)?\w+\s*\([^)]*\)\s*\{/.test(trimmed) ||
                          /^(static\s+)?(async\s+)?\w+\s*\(/.test(trimmed);

      if (!inFunction) {
        if (isFuncStart && line.includes('{')) {
          skeleton.push(line.replace(/\{.*$/, '{ /* ... */ }'));
          inFunction = true;
          braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
          if (braceDepth <= 0) inFunction = false;
        } else {
          skeleton.push(line);
        }
      } else {
        braceDepth += (line.match(/\{/g) || []).length;
        braceDepth -= (line.match(/\}/g) || []).length;
        skippedLines++;
        if (braceDepth <= 0) {
          inFunction = false;
        }
      }
    }

    const originalLines = lines.length;
    const skeletonLines = skeleton.length;
    const reduction = ((1 - skeletonLines / originalLines) * 100).toFixed(0);
    return `[ACE Skeleton — ${skeletonLines}/${originalLines} lines, ${reduction}% reduced]\n\n` + skeleton.join('\n');
  } catch (e) {
    return `[Error] ${e.message}`;
  }
}

// ─── 工具 schema ──────────────────────────────────────────────────────────────
const BASELINE_TOOLS = [{
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read the full content of a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute file path' } },
      required: ['path']
    }
  }
}];

const ACE_TOOLS = [{
  type: 'function',
  function: {
    name: 'read_file_skeleton',
    description: 'Read a file in skeleton mode — returns function signatures only, not full bodies. Saves 70-90% tokens.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute file path' } },
      required: ['path']
    }
  }
}];

// ─── 运行单个任务 ─────────────────────────────────────────────────────────────
async function runTask(taskName, userPrompt, useACE) {
  const tools = useACE ? ACE_TOOLS : BASELINE_TOOLS;
  const systemPrompt = useACE
    ? 'You are Claude-ACE. Files are served in skeleton mode (signatures only). Answer based on the structure shown.'
    : 'You are an AI coding assistant. Read files as needed to answer accurately.';

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  let inputTokens = 0, outputTokens = 0, toolCalls = 0;

  for (let step = 0; step < 8; step++) {
    let res;
    try {
      res = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens: 1000
      });
    } catch (e) {
      return { error: e.message, inputTokens, outputTokens, toolCalls };
    }

    const msg = res.choices[0].message;
    messages.push(msg);

    if (res.usage) {
      inputTokens += res.usage.prompt_tokens || 0;
      outputTokens += res.usage.completion_tokens || 0;
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, toolCalls, answer: msg.content };
    }

    for (const tc of msg.tool_calls) {
      toolCalls++;
      let args = {};
      try { args = JSON.parse(tc.function.arguments); } catch (_) {}

      let result;
      if (tc.function.name === 'read_file') {
        result = baselineReadFile(args.path || '');
      } else if (tc.function.name === 'read_file_skeleton') {
        result = aceReadFileSkeleton(args.path || '');
      } else {
        result = `[Tool not found: ${tc.function.name}]`;
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.function.name,
        content: result.substring(0, 8000) // 防止单次结果过大
      });
    }

    // 限速
    await new Promise(r => setTimeout(r, 500));
  }

  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, toolCalls, answer: '[max steps]' };
}

// ─── 测试任务 ─────────────────────────────────────────────────────────────────
const TASKS = [
  {
    name: '任务1：理解大文件架构',
    prompt: `请读取文件 ${AGENT_FILE}，简要描述它的整体架构和主要功能。`
  },
  {
    name: '任务2：查找特定函数逻辑',
    prompt: `请读取文件 ${INTENT_FILE}，告诉我 execute 方法的主要逻辑流程。`
  },
  {
    name: '任务3：理解模块职责',
    prompt: `请读取文件 ${WATCHDOG_FILE}，告诉我 WatchdogAgent 的主要职责和工作机制。`
  }
];

// ─── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(chalk.cyan('╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║       Claude-ACE Token 节约效果实测（GLM 真实 API）       ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════════════════════╝\n'));

  const results = [];

  for (const task of TASKS) {
    console.log(chalk.white(`━━━ ${task.name} ━━━`));

    // 原始模式
    process.stdout.write(chalk.gray('  [原始模式] 运行中...'));
    const baseline = await runTask(task.name, task.prompt, false);
    readline_clear();
    if (baseline.error) {
      console.log(chalk.red(`  [原始模式] 错误: ${baseline.error}`));
      continue;
    }
    console.log(chalk.white(`  [原始模式] 输入 ${baseline.inputTokens.toLocaleString()} + 输出 ${baseline.outputTokens.toLocaleString()} = ${baseline.totalTokens.toLocaleString()} tokens，${baseline.toolCalls} 次工具调用`));

    await new Promise(r => setTimeout(r, 1500));

    // ACE 模式
    process.stdout.write(chalk.gray('  [ACE 模式] 运行中...'));
    const ace = await runTask(task.name, task.prompt, true);
    readline_clear();
    if (ace.error) {
      console.log(chalk.red(`  [ACE 模式] 错误: ${ace.error}`));
      continue;
    }
    console.log(chalk.cyan(`  [ACE 模式]  输入 ${ace.inputTokens.toLocaleString()} + 输出 ${ace.outputTokens.toLocaleString()} = ${ace.totalTokens.toLocaleString()} tokens，${ace.toolCalls} 次工具调用`));

    const saved = baseline.totalTokens - ace.totalTokens;
    const pct = baseline.totalTokens > 0 ? (saved / baseline.totalTokens * 100).toFixed(1) : '0.0';
    const color = parseFloat(pct) >= 50 ? chalk.green : chalk.yellow;
    console.log(color(`  [节约]     ${saved.toLocaleString()} tokens（节约 ${pct}%）`));
    console.log('');

    results.push({ task: task.name, baseline: baseline.totalTokens, ace: ace.totalTokens, saved, pct: parseFloat(pct) });

    await new Promise(r => setTimeout(r, 2000));
  }

  if (results.length === 0) {
    console.log(chalk.red('没有成功的测试结果，请检查 API Key 和模型配置。'));
    return;
  }

  // 汇总
  const totalB = results.reduce((s, r) => s + r.baseline, 0);
  const totalA = results.reduce((s, r) => s + r.ace, 0);
  const totalSaved = totalB - totalA;
  const totalPct = totalB > 0 ? (totalSaved / totalB * 100).toFixed(1) : '0.0';

  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.white('汇总结果'));
  console.log(`  原始模式总计：${chalk.white(totalB.toLocaleString())} tokens`);
  console.log(`  ACE 模式总计：${chalk.cyan(totalA.toLocaleString())} tokens`);
  console.log(chalk.green(`  总节约：      ${totalSaved.toLocaleString()} tokens（节约 ${totalPct}%）`));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  // 保存结果
  const resultPath = path.join(__dirname, 'glm_bench_results.json');
  fs.writeFileSync(resultPath, JSON.stringify({ model: MODEL, results, summary: { totalB, totalA, totalSaved, totalPct } }, null, 2));
  console.log(chalk.gray(`  结果已保存到 benchmarks/glm_bench_results.json`));
}

function readline_clear() {
  process.stdout.clearLine?.(0);
  process.stdout.cursorTo?.(0);
}

main().catch(e => {
  console.error(chalk.red('\n[错误] ' + e.message));
  if (e.message.includes('API') || e.message.includes('key') || e.message.includes('auth')) {
    console.error(chalk.gray('请确认 OPENAI_API_KEY 和 OPENAI_BASE_URL 环境变量已正确设置。'));
  }
});
