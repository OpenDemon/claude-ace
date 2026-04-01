/**
 * WatchdogAgent.js — Active Evolution & Self-Healing Daemon
 * Author: OpenDemon
 * 
 * This module implements Dimension 2 of the Ideal AI Coding Assistant:
 * "From Passive Execution to Active Evolution & Self-Healing"
 * 
 * It runs as a background daemon, monitoring the codebase for:
 * 1. Test failures (Self-healing)
 * 2. Linting/Type errors (Technical debt reduction)
 * 3. Performance bottlenecks (Active evolution)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { IntentVerificationTool } from '../tools/IntentVerificationTool.js';

export class WatchdogAgent {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.intervalMs = options.intervalMs || 60000; // Default: check every 60s
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
    
    // Run immediately once
    this.scanAndHeal().catch(e => this.log(`Error in initial scan: ${e.message}`));
    
    // Then schedule
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
    
    // 1. Check for test failures
    const testIssues = this.checkTests();
    if (testIssues) {
      this.log(`Detected test failures in ${testIssues.file}. Initiating self-healing...`);
      await this.heal(testIssues);
      return; // Heal one issue at a time to avoid conflicts
    }

    // 2. Check for linting/type errors (Simulated for now, would use ESLint/TSC in real world)
    const lintIssues = this.checkLinting();
    if (lintIssues) {
      this.log(`Detected linting/type issues in ${lintIssues.file}. Initiating self-healing...`);
      await this.heal(lintIssues);
      return;
    }

    this.log('Scan complete. Codebase is healthy.');
  }

  checkTests() {
    try {
      // In a real project, this would run `npm test` or similar
      // For our prototype, we'll look for a specific marker file that simulates a broken test
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
    } catch (e) {
      return null;
    }
  }

  checkLinting() {
    try {
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
    } catch (e) {
      return null;
    }
  }

  async heal(issue) {
    this.log(`Healing process started for: ${issue.file}`);
    this.log(`Intent: ${issue.intent}`);

    try {
      // We reuse the IntentVerificationTool to perform the actual healing!
      // This is the beauty of the architecture: the verification loop is a primitive
      // that can be driven by a human (via Agent) or by a machine (via Watchdog).
      const result = await this.ivt.execute({
        intent: issue.intent,
        targetFile: issue.file,
        testFramework: 'node',
        maxRetries: 3
      });

      if (result.includes('SUCCESS')) {
        this.log(`Healing SUCCESSFUL for ${issue.file}`);
        // Clean up the marker file
        const markerFile = issue.type === 'test_failure' ? '.broken-test.json' : '.broken-lint.json';
        fs.unlinkSync(path.join(this.projectRoot, markerFile));
      } else {
        this.log(`Healing FAILED for ${issue.file}. Manual intervention required.`);
      }
    } catch (e) {
      this.log(`Healing CRASHED for ${issue.file}: ${e.message}`);
    }
  }
}
