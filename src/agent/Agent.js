/**
 * Agent.js — Core agent loop with tool orchestration
 * Author: OpenDemon
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are ACE-Coder, an advanced AI coding assistant powered by the Adaptive Context Engine (ACE).

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

  async chat(userMessage) {
    this.messages.push({ role: 'user', content: userMessage });
    
    for (let step = 0; step < 20; step++) {
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: this.messages,
        tools: this._toOpenAITools(),
        tool_choice: 'auto',
        temperature: 0.1
      });

      const msg = response.choices[0].message;
      this.messages.push(msg);

      if (response.usage) {
        this.stats.inputTokens += response.usage.prompt_tokens;
        this.stats.outputTokens += response.usage.completion_tokens;
      }

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return { answer: msg.content, stats: this.stats };
      }

      for (const tc of msg.tool_calls) {
        this.stats.toolCalls++;
        const args = JSON.parse(tc.function.arguments);
        const tool = this.tools.find(t => t.name === tc.function.name);
        const result = tool
          ? await tool.execute(args)
          : `[Error] Tool "${tc.function.name}" not found`;

        this.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: result
        });
      }
    }

    return { answer: '[Agent] Max steps reached', stats: this.stats };
  }

  resetStats() {
    this.stats = { inputTokens: 0, outputTokens: 0, toolCalls: 0 };
  }
}
