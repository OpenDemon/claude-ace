/**
 * CallGraphTool.js — Call Graph & Impact Analysis
 * Author: OpenDemon
 *
 * Dimension 1 upgrade: "From structural skeleton to live call graph"
 *
 * Builds a call graph for a file (or directory) using tree-sitter AST parsing:
 *   - callers(fn): which functions call `fn`?  (impact analysis: who breaks if I change fn?)
 *   - callees(fn): which functions does `fn` call?  (dependency analysis)
 *   - impact(fn):  full transitive set of callers (butterfly-effect analysis)
 *
 * No external dependencies — uses the already-installed tree-sitter.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const Parser = require('tree-sitter');
const { typescript, tsx } = require('tree-sitter-typescript');

const BUFFER_SIZE = 2 * 1024 * 1024;

/**
 * Parse a single file and return { functionName -> Set<calledFunctionNames> }
 */
function buildFileCallGraph(filePath) {
  const source = fs.readFileSync(filePath, 'utf-8');
  const isTsx = filePath.endsWith('.tsx');
  const parser = new Parser();
  parser.setLanguage(isTsx ? tsx : typescript);

  let tree;
  try {
    tree = parser.parse(source, null, { bufferSize: BUFFER_SIZE });
  } catch (_) {
    return {};
  }

  const graph = {}; // functionName -> Set<callee>
  const lines = source.split('\n');

  /**
   * Walk the AST and collect (definer, callee) pairs.
   * We track the "current function" as we descend into function bodies.
   */
  function visit(node, currentFn) {
    // Entering a function definition — update currentFn
    const defTypes = ['function_declaration', 'method_definition', 'function'];
    if (defTypes.includes(node.type)) {
      // function_declaration / function: name is an 'identifier' child
      // method_definition: name is a 'property_identifier' child
      const nameNode = node.children.find(
        c => c.type === 'identifier' || c.type === 'property_identifier'
      );
      if (nameNode) {
        const fnName = nameNode.text;
        // Skip 'constructor' — it collides with Object.prototype.constructor
        if (fnName === 'constructor') { /* skip */ }
        else {
          currentFn = fnName;
          if (!(graph[currentFn] instanceof Set)) graph[currentFn] = new Set();
        }
      }
    }

    // Arrow function assigned to a variable: const foo = () => ...
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      const declarator = node.children.find(c => c.type === 'variable_declarator');
      if (declarator) {
        const nameNode = declarator.children.find(c => c.type === 'identifier');
        const valueNode = declarator.children.find(c =>
          c.type === 'arrow_function' || c.type === 'function'
        );
        if (nameNode && valueNode) {
          currentFn = nameNode.text;
          if (!graph[currentFn]) graph[currentFn] = new Set();
        }
      }
    }

    // Call expression inside a function body
    if (node.type === 'call_expression' && currentFn) {
      const calleeNode = node.children[0];
      if (calleeNode) {
        // Handle simple calls: foo(), and member calls: obj.foo()
        let calleeName = calleeNode.text;
        if (calleeNode.type === 'member_expression') {
          // e.g. this.ivt.execute → take the last identifier
          const parts = calleeName.split('.');
          calleeName = parts[parts.length - 1];
        }
        if (calleeName && calleeName !== currentFn) {
          if (!(graph[currentFn] instanceof Set)) graph[currentFn] = new Set();
          graph[currentFn].add(calleeName);
        }
      }
    }

    for (const child of node.children) {
      visit(child, currentFn);
    }
  }

  visit(tree.rootNode, null);

  // Convert Sets to Arrays for serialization
  const result = {};
  for (const [fn, callees] of Object.entries(graph)) {
    result[fn] = [...callees];
  }
  return result;
}

/**
 * Build a combined call graph from all JS/TS files in a directory.
 */
function buildDirectoryCallGraph(dirPath) {
  const combined = {};
  const files = [];

  function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        collect(full);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        files.push(full);
      }
    }
  }

  collect(dirPath);
  for (const f of files) {
    const fg = buildFileCallGraph(f);
    for (const [fn, callees] of Object.entries(fg)) {
      if (!combined[fn]) combined[fn] = new Set();
      for (const c of callees) combined[fn].add(c);
    }
  }

  const result = {};
  for (const [fn, callees] of Object.entries(combined)) {
    result[fn] = [...callees];
  }
  return result;
}

/**
 * Given a call graph (fn -> callees[]), build the reverse: fn -> callers[]
 */
function buildReverseGraph(graph) {
  const reverse = Object.create(null); // null prototype avoids collision with Object.prototype
  for (const [caller, callees] of Object.entries(graph)) {
    for (const callee of callees) {
      if (!reverse[callee]) reverse[callee] = [];
      reverse[callee].push(caller);
    }
  }
  return reverse;
}

/**
 * Transitive closure: all functions that (directly or indirectly) call `fn`.
 */
function transitiveCallers(fn, reverseGraph) {
  const visited = new Set();
  const queue = [fn];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const caller of (reverseGraph[current] || [])) {
      if (!visited.has(caller)) {
        visited.add(caller);
        queue.push(caller);
      }
    }
  }
  return [...visited];
}

// ─── Tool Wrapper ────────────────────────────────────────────────────────────

export class CallGraphTool {
  get name() { return 'CallGraph'; }
  get description() {
    return 'Analyze the call graph of a file or directory to understand function dependencies and impact. ' +
      'Use "callees" to see what a function calls. ' +
      'Use "callers" to see what calls a function (direct impact). ' +
      'Use "impact" to see the full transitive set of callers (butterfly-effect analysis: who breaks if I change this function?). ' +
      'Use this BEFORE modifying a widely-used function to understand the blast radius.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to a file or directory to analyze'
        },
        query: {
          type: 'string',
          enum: ['callees', 'callers', 'impact', 'full_graph'],
          description: 'What to query: callees (what fn calls), callers (who calls fn), impact (transitive callers), full_graph (entire graph)'
        },
        functionName: {
          type: 'string',
          description: 'Function name to query (required for callees/callers/impact)'
        }
      },
      required: ['path', 'query']
    };
  }

  async execute({ path: targetPath, query, functionName }) {
    if (!fs.existsSync(targetPath)) {
      return `[CallGraph Error] Path not found: ${targetPath}`;
    }

    const stat = fs.statSync(targetPath);
    const graph = stat.isDirectory()
      ? buildDirectoryCallGraph(targetPath)
      : buildFileCallGraph(targetPath);

    if (Object.keys(graph).length === 0) {
      return `[CallGraph] No functions found in ${targetPath}`;
    }

    switch (query) {
      case 'full_graph': {
        const lines = Object.entries(graph)
          .filter(([, callees]) => callees.length > 0)
          .map(([fn, callees]) => `  ${fn} → [${callees.join(', ')}]`);
        return `[CallGraph] Full call graph for ${targetPath}:\n${lines.join('\n')}\n\nTotal functions: ${Object.keys(graph).length}`;
      }

      case 'callees': {
        if (!functionName) return '[CallGraph Error] functionName is required for "callees" query';
        const callees = graph[functionName];
        if (!callees) return `[CallGraph] Function "${functionName}" not found or has no outgoing calls.`;
        if (callees.length === 0) return `[CallGraph] "${functionName}" does not call any other functions.`;
        return `[CallGraph] "${functionName}" calls:\n${callees.map(c => `  → ${c}`).join('\n')}`;
      }

      case 'callers': {
        if (!functionName) return '[CallGraph Error] functionName is required for "callers" query';
        const reverse = buildReverseGraph(graph);
        const callers = reverse[functionName] || [];
        if (callers.length === 0) return `[CallGraph] No functions call "${functionName}" (it may be an entry point or externally called).`;
        return `[CallGraph] Functions that directly call "${functionName}":\n${callers.map(c => `  ← ${c}`).join('\n')}`;
      }

      case 'impact': {
        if (!functionName) return '[CallGraph Error] functionName is required for "impact" query';
        const reverse = buildReverseGraph(graph);
        const affected = transitiveCallers(functionName, reverse);
        if (affected.length === 0) {
          return `[CallGraph] Impact analysis for "${functionName}": No other functions depend on it. Safe to modify.`;
        }
        return [
          `[CallGraph] Impact analysis for "${functionName}":`,
          `Modifying this function may break ${affected.length} function(s):`,
          affected.map(f => `  ⚠️  ${f}`).join('\n'),
          `\nRecommendation: Review these callers before making changes.`
        ].join('\n');
      }

      default:
        return `[CallGraph Error] Unknown query: ${query}`;
    }
  }
}
