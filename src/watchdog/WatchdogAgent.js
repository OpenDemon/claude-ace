/**
 * WatchdogAgent.js — Active Evolution & Self-Healing Daemon
 * Author: OpenDemon
 *
 * Dimension 2: "From Passive Execution to Active Evolution & Self-Healing"
 *
 * v0.3.0: checkTests() now runs `npm test` for real and parses output.
 *         checkLinting() now runs `eslint` for real.
 *         Both fall back to marker-file simulation when tooling is absent.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { IntentVerificationTool } from '../tools/IntentVerificationTool.js';

export class WatchdogAgent {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.intervalMs = options.intervalMs || 60000;
    this.isRunning = false;
    this.timer = null;
    this.ivt = new IntentVerificationTool();
    this.logFile = path.join(projectRoot, '.ace-watchdog.log');
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] [Watchdog] ${message}\n`;
    process.stdout.write(logMsg);
    fs.appendFileSync(this.logFile, logMsg);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.log('Starting background watchdog daemon...');
    this.scanAndHeal().catch(e => this.log(`Error in initial scan: ${e.message}`));
    this.timer = setInterval(() => {
      this.scanAndHeal().catch(e => this.log(`Error in scheduled scan: ${e.message}`));
    }, this.intervalMs);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
    this.log('Watchdog daemon stopped.');
  }

  async scanAndHeal() {
    this.log('Initiating codebase health scan...');

    const testIssues = await this.checkTests();
    if (testIssues) {
      this.log(`Detected test failures. Initiating self-healing...`);
      await this.heal(testIssues);
      return;
    }

    const lintIssues = await this.checkLinting();
    if (lintIssues) {
      this.log(`Detected linting issues. Initiating self-healing...`);
      await this.heal(lintIssues);
      return;
    }

    this.log('Scan complete. Codebase is healthy.');
  }

  /**
   * Run `npm test` for real and parse failures.
   * Falls back to .broken-test.json simulation if no test script exists.
   */
  async checkTests() {
    const pkgPath = path.join(this.projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const testScript = pkg.scripts && pkg.scripts.test;
      const isRealScript = testScript &&
        !testScript.includes('no test specified') &&
        !testScript.includes('echo');

      if (isRealScript) {
        this.log(`Running: npm test (script: "${testScript}")`);
        const result = spawnSync('npm', ['test'], {
          cwd: this.projectRoot,
          encoding: 'utf-8',
          timeout: 120000,
          env: { ...process.env }
        });

        if (result.status !== 0) {
          const output = (result.stdout || '') + (result.stderr || '');
          const failingFile = this._extractFailingFile(output);
          // If we can't identify a specific file, skip healing to avoid crashing on a directory
          if (!failingFile) {
            this.log('Tests failed but could not identify a specific file to heal. Skipping auto-heal.');
            return null;
          }
          return {
            type: 'test_failure',
            file: failingFile,
            error: output.substring(0, 2000),
            intent: `Fix the failing test. Error output:\n${output.substring(0, 1000)}`
          };
        }
        return null;
      }
    }

    // Fallback: marker-file simulation
    const brokenMarker = path.join(this.projectRoot, '.broken-test.json');
    if (fs.existsSync(brokenMarker)) {
      const data = JSON.parse(fs.readFileSync(brokenMarker, 'utf-8'));
      return {
        type: 'test_failure',
        file: data.file,
        error: data.error,
        intent: `Fix the failing test in ${data.file}. The error is: ${data.error}`
      };
    }
    return null;
  }

  /**
   * Run `eslint` for real and parse errors.
   * Falls back to .broken-lint.json simulation if eslint is not installed.
   */
  async checkLinting() {
    const eslintBin = path.join(this.projectRoot, 'node_modules', '.bin', 'eslint');
    if (fs.existsSync(eslintBin)) {
      this.log('Running: eslint src/');
      const result = spawnSync(eslintBin, ['src/', '--format', 'json', '--max-warnings', '0'], {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 30000
      });

      if (result.status !== 0 && result.stdout) {
        try {
          const eslintResults = JSON.parse(result.stdout);
          const firstError = eslintResults.find(r => r.errorCount > 0);
          if (firstError) {
            const errorMessages = firstError.messages
              .slice(0, 3)
              .map(m => `Line ${m.line}: ${m.message} (${m.ruleId})`)
              .join('\n');
            return {
              type: 'lint_error',
              file: firstError.filePath,
              error: errorMessages,
              intent: `Fix the ESLint errors in ${firstError.filePath}:\n${errorMessages}`
            };
          }
        } catch (_) { /* JSON parse failed */ }
      }
      return null;
    }

    // Fallback: marker-file simulation
    const brokenMarker = path.join(this.projectRoot, '.broken-lint.json');
    if (fs.existsSync(brokenMarker)) {
      const data = JSON.parse(fs.readFileSync(brokenMarker, 'utf-8'));
      return {
        type: 'lint_error',
        file: data.file,
        error: data.error,
        intent: `Fix the linting/type error in ${data.file}. The error is: ${data.error}`
      };
    }
    return null;
  }

  /** Extract the first failing source file from test runner output. */
  _extractFailingFile(output) {
    // Windows absolute path: C:\Users\...\file.js or C:/Users/.../file.js
    const winMatch = output.match(/([A-Za-z]:[\\/][\w\\\/\-\.]+\.(?:js|ts|jsx|tsx))/);
    if (winMatch) {
      const candidate = winMatch[1];
      // Only return if it's actually a file, not a directory
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch (_) {}
    }
    // Jest output: FAIL src/tools/Foo.js
    const jestMatch = output.match(/FAIL\s+([\w/.-]+\.(?:js|ts))/);
    if (jestMatch) return path.join(this.projectRoot, jestMatch[1]);
    // Node tap / generic: src/tools/Foo.js
    const genericMatch = output.match(/(src[\\/][\w\\/\-\.]+\.(?:js|ts))/);
    if (genericMatch) return path.join(this.projectRoot, genericMatch[1]);
    return null;
  }

  async heal(issue) {
    this.log(`Healing: ${issue.file}`);
    try {
      const result = await this.ivt.execute({
        intent: issue.intent,
        targetFile: issue.file,
        testFramework: 'node',
        maxRetries: 3
      });

      if (result.includes('SUCCESS')) {
        this.log(`Healing SUCCESSFUL for ${issue.file}`);
        const markerFile = issue.type === 'test_failure' ? '.broken-test.json' : '.broken-lint.json';
        const markerPath = path.join(this.projectRoot, markerFile);
        if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
      } else {
        this.log(`Healing FAILED for ${issue.file}. Manual intervention required.`);
      }
    } catch (e) {
      this.log(`Healing CRASHED for ${issue.file}: ${e.message}`);
    }
  }
}
