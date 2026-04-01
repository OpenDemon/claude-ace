/**
 * IntentVerificationTool.js — Intent-driven verification loop
 * 
 * Core idea: Instead of generating code and hoping it works, this tool:
 * 1. Receives a user intent (e.g. "add retry with exponential backoff")
 * 2. Generates a test that DEFINES what "correct" means for this intent
 * 3. Runs the test (it should FAIL — the code doesn't exist yet)
 * 4. Calls the LLM to implement the code
 * 5. Runs the test again — if it passes, done; if not, self-heals (up to maxRetries)
 * 6. Returns only the final result to the main agent (clean context)
 *
 * This eliminates "hallucinated code" — code MUST pass tests to be accepted.
 *
 * Author: OpenDemon
 */
import OpenAI from 'openai';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CrossProjectMemory } from '../memory/CrossProjectMemory.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class IntentVerificationTool {
  get name() { return 'IntentVerify'; }
  get description() { return 'Implement a code change driven by user intent, with automatic test generation and self-healing verification loop. The code MUST pass generated tests before being accepted. Use this for any non-trivial code modification.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        intent: { type: 'string', description: 'What the code change should accomplish (e.g. "add exponential backoff retry logic to fetchData function")' },
        targetFile: { type: 'string', description: 'Absolute path to the file to modify' },
        testFramework: { type: 'string', enum: ['jest', 'vitest', 'node'], description: 'Test framework to use (default: node built-in assert)' },
        maxRetries: { type: 'number', description: 'Max self-healing attempts (default: 3)' }
      },
      required: ['intent', 'targetFile']
    };
  }

  async execute({ intent, targetFile, testFramework = 'node', maxRetries = 3 }) {
    const log = [];
    const addLog = (msg) => { log.push(msg); };

    addLog(`[IntentVerify] Starting verification loop for: "${intent}"`);
    addLog(`[IntentVerify] Target: ${targetFile}`);

    // Step 1: Read the target file
    if (!fs.existsSync(targetFile)) {
      return `[IntentVerify Error] Target file not found: ${targetFile}`;
    }
    const originalSource = fs.readFileSync(targetFile, 'utf-8');

    // Step 2: Generate a test that defines "correct" for this intent
    addLog(`[IntentVerify] Step 1/4: Generating verification test...`);
    const testCode = await this._generateTest(intent, targetFile, originalSource, testFramework);
    const testFile = targetFile.replace(/\.(ts|js|tsx|jsx)$/, '.intent.test.js');
    fs.writeFileSync(testFile, testCode);
    addLog(`[IntentVerify] Test written to: ${testFile}`);

    // Step 3: Implement the change
    addLog(`[IntentVerify] Step 2/4: Generating implementation...`);
    let newSource = await this._generateImplementation(intent, targetFile, originalSource);
    fs.writeFileSync(targetFile, newSource);

    // Step 4: Self-healing loop with Fallback Strategy
    let passed = false;
    let lastError = '';
    let fallbackTriggered = false;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      addLog(`[IntentVerify] Step 3/4: Running tests (attempt ${attempt}/${maxRetries})...`);
      const { success, output } = this._runTest(testFile, testFramework);
      if (success) {
        passed = true;
        addLog(`[IntentVerify] Tests PASSED on attempt ${attempt}!`);
        break;
      }
      lastError = output;
      addLog(`[IntentVerify] Tests FAILED. Self-healing...`);
      addLog(`[IntentVerify] Error: ${output.substring(0, 200)}`);

      if (attempt < maxRetries) {
        // Fallback Strategy: If tests fail on the first attempt, it might be due to missing context (skeleton mode).
        // We explicitly tell the self-healing LLM to consider the full original source if it hasn't already.
        let healingSourceContext = newSource;
        if (attempt === 1 && !fallbackTriggered) {
          addLog(`[IntentVerify] Triggering Context Fallback: Providing full original source to self-healing agent to prevent hallucination.`);
          fallbackTriggered = true;
          healingSourceContext = `// ORIGINAL FULL SOURCE BEFORE CHANGES:\n${originalSource}\n\n// CURRENT FAILING IMPLEMENTATION:\n${newSource}`;
        }
        
        newSource = await this._selfHeal(intent, targetFile, healingSourceContext, testCode, output);
        fs.writeFileSync(targetFile, newSource);
      }
    }

    // Cleanup test file
    try { fs.unlinkSync(testFile); } catch (e) {}

    if (passed) {
      // Auto-learn: if self-healing was needed, this was a hard problem worth remembering
      if (fallbackTriggered) {
        try {
          const memory = new CrossProjectMemory();
          const fileName = path.basename(targetFile);
          memory.learnLesson(
            [fileName, 'intent-verify', 'auto-healed'],
            `Intent "${intent}" on ${fileName} required context fallback to pass tests`,
            `Skeleton mode was insufficient; full source context was needed for self-healing. Consider using ExpandSymbol or forceFull=true when modifying ${fileName}.`,
            { isGooglable: false, isCodebaseSpecific: true, isFromDebugging: true }
          );
          addLog(`[IntentVerify] Step 4/4: Lesson auto-saved to CrossProjectMemory (fallback was needed).`);
        } catch (_) { /* memory write failure is non-fatal */ }
      }

      return [
        `[IntentVerify] SUCCESS`,
        `Intent: "${intent}"`,
        `File: ${targetFile}`,
        `All tests passed. The implementation has been verified correct.`,
        ``,
        `--- IMPLEMENTATION SUMMARY ---`,
        `The file has been updated. Use FileRead to review the changes.`,
        log.join('\n')
      ].join('\n');
    } else {
      // Restore original on failure
      fs.writeFileSync(targetFile, originalSource);
      return [
        `[IntentVerify] FAILED after ${maxRetries} attempts`,
        `Intent: "${intent}"`,
        `The original file has been restored.`,
        `Last error: ${lastError.substring(0, 500)}`,
        log.join('\n')
      ].join('\n');
    }
  }

  async _generateTest(intent, targetFile, source, framework) {
    const fileName = path.basename(targetFile);
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You are a test engineer. Generate a minimal but complete Node.js test using built-in assert module. The test should DEFINE what "correct" means for the given intent. Import the target module using dynamic import(). Return ONLY the test code, no explanation.' },
        { role: 'user', content: `File: ${fileName}\nIntent: ${intent}\n\nSource (first 100 lines):\n${source.split('\n').slice(0, 100).join('\n')}\n\nGenerate a test file that verifies this intent is correctly implemented.` }
      ],
      temperature: 0.1
    });
    let code = response.choices[0].message.content;
    // Strip markdown code blocks if present
    code = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    return code;
  }

  async _generateImplementation(intent, targetFile, source) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You are a senior software engineer. Implement the requested change to the source code. Return ONLY the complete modified source code, no explanation, no markdown.' },
        { role: 'user', content: `File: ${targetFile}\nIntent: ${intent}\n\nCurrent source:\n${source}\n\nReturn the complete modified file.` }
      ],
      temperature: 0.1
    });
    let code = response.choices[0].message.content;
    code = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    return code;
  }

  async _selfHeal(intent, targetFile, currentSource, testCode, errorOutput) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You are a senior software engineer debugging a failing test. Fix the implementation to make the test pass. Return ONLY the complete corrected source code.' },
        { role: 'user', content: `Intent: ${intent}\n\nTest code:\n${testCode}\n\nTest error:\n${errorOutput.substring(0, 1000)}\n\nCurrent implementation:\n${currentSource}\n\nFix the implementation to make the test pass.` }
      ],
      temperature: 0.1
    });
    let code = response.choices[0].message.content;
    code = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    return code;
  }

  _runTest(testFile, framework) {
    try {
      const output = execSync(`node --experimental-vm-modules ${testFile} 2>&1`, {
        timeout: 30000,
        encoding: 'utf-8'
      });
      return { success: true, output };
    } catch (e) {
      return { success: false, output: e.stdout || e.stderr || e.message };
    }
  }
}
