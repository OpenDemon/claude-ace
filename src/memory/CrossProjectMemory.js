/**
 * CrossProjectMemory.js — Cross-Dimensional Engineering Intuition
 * Author: OpenDemon
 * 
 * This module implements Dimension 5 of the Ideal AI Coding Assistant:
 * "From Project-Level Context to Cross-Dimensional Engineering Intuition"
 * 
 * It provides a persistent memory store (using local JSON for prototype, 
 * would be a Vector DB in production) that allows the AI to:
 * 1. Store lessons learned from one project
 * 2. Retrieve relevant architectural patterns for new projects
 * 3. Build a "developer profile" to avoid repeating preferences
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export class CrossProjectMemory {
  constructor() {
    // Store memory in user's home directory so it persists across projects
    this.memoryDir = path.join(os.homedir(), '.ace-memory');
    this.dbPath = path.join(this.memoryDir, 'knowledge_graph.json');
    this.initDB();
  }

  initDB() {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, JSON.stringify({
        lessons: [],
        patterns: [],
        userPreferences: {}
      }, null, 2));
    }
  }

  getDB() {
    return JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
  }

  saveDB(data) {
    fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
  }

  /**
   * Store a lesson learned (e.g., a bug that was hard to fix)
   */
  learnLesson(tags, description, solution) {
    const db = this.getDB();
    db.lessons.push({
      id: Date.now().toString(),
      tags,
      description,
      solution,
      timestamp: new Date().toISOString()
    });
    this.saveDB(db);
    return `Lesson learned and stored under tags: ${tags.join(', ')}`;
  }

  /**
   * Retrieve relevant knowledge based on current context/tags
   */
  recall(tags) {
    const db = this.getDB();
    const results = [];

    // Simple tag intersection matching (would be semantic search in prod)
    for (const lesson of db.lessons) {
      const matchCount = lesson.tags.filter(t => tags.includes(t)).length;
      if (matchCount > 0) {
        results.push({ ...lesson, score: matchCount });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 3); // Return top 3 relevant memories
  }

  /**
   * Update user preferences (e.g., "always use spaces instead of tabs")
   */
  setPreference(key, value) {
    const db = this.getDB();
    db.userPreferences[key] = value;
    this.saveDB(db);
    return `Preference saved: ${key} = ${value}`;
  }

  getPreferences() {
    return this.getDB().userPreferences;
  }
}

// Tool Wrapper for the Agent
export class MemoryTool {
  constructor() {
    this.memory = new CrossProjectMemory();
  }

  get name() { return 'Memory'; }
  get description() { 
    return 'Access cross-project memory to learn lessons, recall past solutions, or check user preferences.'; 
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['learn', 'recall', 'set_pref', 'get_prefs'] },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for learn/recall' },
        description: { type: 'string', description: 'Problem description (for learn)' },
        solution: { type: 'string', description: 'Solution found (for learn)' },
        key: { type: 'string', description: 'Preference key' },
        value: { type: 'string', description: 'Preference value' }
      },
      required: ['action']
    };
  }

  async execute(params) {
    switch (params.action) {
      case 'learn':
        return this.memory.learnLesson(params.tags || [], params.description, params.solution);
      case 'recall':
        const results = this.memory.recall(params.tags || []);
        if (results.length === 0) return 'No relevant memories found.';
        return 'Recalled past lessons:\n' + results.map(r => `- [${r.tags.join(',')}] ${r.description}\n  Solution: ${r.solution}`).join('\n');
      case 'set_pref':
        return this.memory.setPreference(params.key, params.value);
      case 'get_prefs':
        return JSON.stringify(this.memory.getPreferences(), null, 2);
      default:
        return 'Invalid action';
    }
  }
}
