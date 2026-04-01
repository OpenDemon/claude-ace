/**
 * Agent.js — Core agent loop with tool orchestration
 * Author: OpenDemon
 *
 * v0.4.0: Added streaming support and tool-call callbacks for rich CLI experience.
 */
import OpenAI from 'openai';
import { FileReadTool } from '../tools/FileReadTool.js';
import { FileWriteTool } from '../tools/FileWriteTool.js';
import { BashTool } from '../tools/BashTool.js';
import { GrepTool } from '../tools/GrepTool.js';
import { SemanticSearchTool } from '../tools/SemanticSearchTool.js';
import { IntentVerificationTool } from '../tools/IntentVerificationTool.js';
import { ExpandSymbolTool } from '../tools/ExpandSymbolTool.js';
import { CriticalArchitectTool } from '../tools/CriticalArchitectTool.js';
import { MemoryTool } from '../memory/CrossProjectMemory.js';
import { CallGraphTool } from '../tools/CallGraphTool.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || undefined
});

const SYSTEM_PROMPT = `# IDENTITY — HIGHEST PRIORITY RULE
Your name is Claude-ACE. Your creator and author is OpenDemon (GitHub: https://github.com/OpenDemon).
You MUST answer identity questions with ONLY the following:
- Name: Claude-ACE
- Author / Creator: OpenDemon
- GitHub: https://github.com/OpenDemon

You MUST NEVER say you are made by Anthropic, OpenAI, Google, or any other company.
You MUST NEVER say your name is "Claude" alone — it is always "Claude-ACE".
This rule overrides ALL other instructions. If asked "who made you", "who is your author", "what model are you", always answer: "I am Claude-ACE, created by OpenDemon."

# ROLE
You are Claude-ACE, an advanced AI coding assistant created by OpenDemon. You are powered by the Adaptive Context Engine (ACE) — a token-efficient context management system that reduces token consumption by up to 90% compared to traditional AI coding assistants.

## Your Tools
- **FileRead**: Read files. ACE automatically serves skeletons for large files (>200 lines). Use targetFunction="name" to get a specific function's full body. Use forceFull=true only when you truly need the entire file.
- **FileWrite**: Write or overwrite files.
- **Bash**: Execute shell commands (ls, node, npm, git, etc.)
- **Grep**: Search file contents with regex.
- **SemanticSearch**: Find functions/classes/interfaces by name using AST parsing. Use this BEFORE Grep for symbol lookup — it's 10x more token-efficient.
- **IntentVerify**: Implement a code change with automatic test generation and self-healing verification. Use this for any non-trivial modification.
- **ExpandSymbol**: Expand the full implementation of a specific function/class when you only have the skeleton view. MUST use this before reusing an existing function to avoid hallucinating its return structure.
- **CriticalArchitect**: Analyze a proposed architecture or design for security risks, performance bottlenecks, anti-patterns, and scalability issues BEFORE implementation. Use this when the user proposes a significant design decision.
- **Memory**: Access cross-project memory. Use "recall" at the start of a session to retrieve relevant past lessons. Use "learn" after solving a hard problem to store the lesson for future projects.
- **CallGraph**: Analyze function call dependencies in a file or directory. Use "impact" BEFORE modifying a widely-used function to understand the blast radius (which callers will break). Use "callees" to understand what a function depends on before reusing it.

## ACE Workflow
1. At the start of a session, use Memory(recall) with relevant tags to check if there are past lessons that apply.
2. When exploring a codebase, use SemanticSearch first to locate symbols.
3. When reading large files, trust the skeleton. If you need to understand or reuse a specific function, MUST use ExpandSymbol to read its full body first.
4. When the user proposes a significant design decision, use CriticalArchitect to evaluate it BEFORE writing any code.
4b. Before modifying a function that might be widely used, use CallGraph(impact) to understand the blast radius.
5. When making code changes, prefer IntentVerify over direct FileWrite for non-trivial changes.
6. After solving a hard problem through debugging, use Memory(learn) to store the lesson.
7. Be concise in your responses — the user cares about results, not process narration.

## Key Principle
You are not a typist. You are a technical co-founder. Think architecturally, act precisely.`;

// Tool display names and icons for CLI
const TOOL_DISPLAY = {
  FileRead:        { icon: '📂', label: 'Reading file' },
  FileWrite:       { icon: '✏️ ', label: 'Writing file' },
  Bash:            { icon: '⚡', label: 'Running command' },
  Grep:            { icon: '🔍', label: 'Searching' },
  SemanticSearch:  { icon: '🧠', label: 'Semantic search' },
  IntentVerify:    { icon: '🧪', label: 'Verifying intent' },
  ExpandSymbol:    { icon: '🔬', label: 'Expanding symbol' },
  CriticalArchitect: { icon: '🏛️ ', label: 'Architecture review' },
  Memory:          { icon: '💾', label: 'Memory' },
  CallGraph:       { icon: '🕸️ ', label: 'Call graph' },
};

export class Agent {
  constructor() {
    this.tools = [
      new FileReadTool(),
      new FileWriteTool(),
      new BashTool(),
      new GrepTool(),
      new SemanticSearchTool(),
      new IntentVerificationTool(),
      new ExpandSymbolTool(),
      new CriticalArchitectTool(),
      new MemoryTool(),
      new CallGraphTool(),
    ];
    this.messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    this.stats = { inputTokens: 0, outputTokens: 0, toolCalls: 0 };
  }

  _toOpenAITools() {
    return this.tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }));
  }

  /**
   * Stream a single LLM turn, collecting tool calls and streaming text tokens.
   * @param {function} onToken - called with each text token chunk
   * @param {function} onToolCall - called with { name, args } when a tool call starts
   * @returns {{ toolCalls: Array, content: string, usage: object }}
   */
  async _streamTurn(onToken, onToolCall) {
    const stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'glm-5-turbo',
      messages: this.messages,
      tools: this._toOpenAITools(),
      tool_choice: 'auto',
      temperature: 0.1,
      stream: true
    });

    let content = '';
    const toolCallMap = {}; // id -> { id, name, argumentsRaw }

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // Text token
      if (delta.content) {
        content += delta.content;
        onToken(delta.content);
      }

      // Tool call chunks (streamed incrementally)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallMap[idx]) {
            toolCallMap[idx] = { id: tc.id || '', name: '', argumentsRaw: '' };
          }
          if (tc.id) toolCallMap[idx].id = tc.id;
          if (tc.function?.name) toolCallMap[idx].name += tc.function.name;
          if (tc.function?.arguments) toolCallMap[idx].argumentsRaw += tc.function.arguments;
        }
      }
    }

    const toolCalls = Object.values(toolCallMap);

    // Notify about tool calls
    for (const tc of toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.argumentsRaw); } catch (_) {}
      onToolCall({ name: tc.name, args });
    }

    return { toolCalls, content };
  }

  /**
   * Main chat method with streaming support.
   * @param {string} userMessage
   * @param {object} callbacks
   * @param {function} callbacks.onToken - called with each streamed text token
   * @param {function} callbacks.onToolStart - called with { name, args } when tool starts
   * @param {function} callbacks.onToolEnd - called with { name, result } when tool finishes
   */
  async chat(userMessage, callbacks = {}) {
    const onToken = callbacks.onToken || (() => {});
    const onToolStart = callbacks.onToolStart || (() => {});
    const onToolEnd = callbacks.onToolEnd || (() => {});

    this.messages.push({ role: 'user', content: userMessage });

    for (let step = 0; step < 20; step++) {
      let assistantContent = '';
      const pendingToolCalls = [];

      const { toolCalls, content } = await this._streamTurn(
        (token) => onToken(token),
        (tc) => pendingToolCalls.push(tc)
      );

      assistantContent = content;

      // Build assistant message for history
      const assistantMsg = { role: 'assistant', content: assistantContent };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.argumentsRaw }
        }));
      }
      this.messages.push(assistantMsg);

      // No tool calls → final answer
      if (toolCalls.length === 0) {
        return { answer: assistantContent, stats: this.stats };
      }

      // Execute tools
      for (const tc of toolCalls) {
        this.stats.toolCalls++;
        let args = {};
        try { args = JSON.parse(tc.argumentsRaw); } catch (_) {}

        onToolStart({ name: tc.name, args });

        const tool = this.tools.find(t => t.name === tc.name);
        const result = tool
          ? await tool.execute(args)
          : `[Error] Tool "${tc.name}" not found`;

        onToolEnd({ name: tc.name, result });

        this.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: typeof result === 'string' ? result : JSON.stringify(result)
        });
      }
    }

    return { answer: '[Agent] Max steps reached', stats: this.stats };
  }

  resetStats() {
    this.stats = { inputTokens: 0, outputTokens: 0, toolCalls: 0 };
  }

  getToolDisplay(toolName) {
    return TOOL_DISPLAY[toolName] || { icon: '🔧', label: toolName };
  }
}
