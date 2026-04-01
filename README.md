# ACE-Coder

> 跨越工具的边界，重塑 AI 编程助手的终极理想态。

ACE-Coder (Adaptive Context Engine Coder) 是一个从第一性原理出发构建的下一代 AI 编程助手原型。它不仅是一个“打字员”，更是一个具备**活体语义图谱**、**自我修复能力**、**意图验证闭环**、**批判性架构思维**和**跨项目长期记忆**的“技术合伙人”。

---

## 🎯 核心愿景与基线对照

本项目以 **Anthropic 官方发布的 Claude Code 源码 (`@anthropic-ai/claude-code@2.1.88`)** 为基线对照组进行深度逆向工程与重构。

在对 Claude Code 源码进行深度分析后，我们发现其存在过度依赖文本检索（Grep/Glob）、缺乏语义理解、强绑定单一模型等局限性。ACE-Coder 旨在打破这些局限，实现五个维度的范式跨越：

| 维度 | Claude Code (基线) | ACE-Coder (理想态) | 核心突破 |
|------|-------------------|--------------------|----------|
| **一：上下文理解** | 文本检索 (Grep/Glob) | **活体系统语义图谱** | 基于 Tree-sitter 的 AST 骨架提取，Token 消耗直降 **84.5%** |
| **二：运行模式** | 被动唤醒的 REPL | **主动演化与自我修复** | 后台 Watchdog 守护进程，主动监控并修复测试/Lint 错误 |
| **三：代码生成** | 直接修改 → 报错 → 重试 | **意图驱动的验证闭环** | 意图 → 生成测试 → 实现代码 → 自愈闭环，强制 TDD |
| **四：架构思维** | 顺从的“打字员” | **批判性思维架构师** | 拒绝糟糕设计，主动反问并提供安全/性能更优的架构建议 |
| **五：知识积累** | 仅限当前项目上下文 | **跨维度工程直觉** | 持久化跨项目记忆 (`~/.ace-memory`)，实现经验迁移 |

---

## 🚀 核心特性与实测战果

### 1. 自适应上下文引擎 (Adaptive Context Engine)
彻底抛弃低效的文本 Grep，使用 Tree-sitter 提取代码的 AST 骨架。
- **实测战果**：在处理长达 1144 行的 `BashTool.tsx` 时，传统全量读取消耗 182,843 tokens，而 ACE 仅消耗 **28,372 tokens**，节省高达 **84.5%**。这使得 Agent 能够同时处理 5 倍以上的代码文件，具备跨模块重构能力。

### 2. 意图驱动的验证闭环 (Intent Verification Loop)
将“修改代码”升级为原子操作。AI 不再直接修改代码，而是先生成单元测试，运行失败后通过内部微型 Agent 循环进行自我修复，直到测试变绿。
- **实测战果**：成功跑通 TTL 缓存、指数退避重试等复杂逻辑的自动 TDD 闭环，主上下文极度整洁，彻底杜绝“幻觉”代码。

### 3. 批判性架构师 (Critical Architect)
当用户提出存在安全漏洞或性能瓶颈的需求时（例如：“把密码明文存在全局数组里”），Agent 会触发 `[CRITIQUE: REJECTED]`，并给出专业的架构重构建议。

### 4. 后台守护进程 (Watchdog Agent)
持续运行的后台进程，主动扫描代码库状态，发现测试失败或潜在 Bug 时，自动复用验证闭环进行静默修复。

### 5. 跨项目长期记忆 (Cross-Project Memory)
赋予 AI 真正的“经验”。在 Project A 中踩过的坑（如 React `useEffect` 的依赖问题），会被持久化存储，并在 Project B 中自动回忆和应用。

---

## 🛠️ 快速开始

### 环境要求
- Node.js >= 18
- Python 3 (用于部分基准测试)
- OpenAI 兼容的 API Key (默认使用 `gpt-4.1-mini`)

### 安装与运行

```bash
# 1. 克隆仓库 (私有仓库，需权限)
git clone https://github.com/OpenDemon/ace-coder.git
cd ace-coder

# 2. 安装依赖
npm install

# 3. 配置环境变量
export OPENAI_API_KEY="your-api-key"

# 4. 运行冒烟测试
npm start

# 5. 运行基准测试 (对比 Baseline 与 ACE 的 Token 消耗)
npm run bench
```

---

## 📚 架构设计

ACE-Coder 的核心架构分为三层：
1. **感知层 (Perception)**：包含 `SemanticSearchTool` 和 `ContextLoader`，负责将物理文件转化为结构化的语义图谱。
2. **决策层 (Reasoning)**：包含 `CriticalArchitectTool` 和 `CrossProjectMemory`，负责架构评估和历史经验检索。
3. **执行层 (Execution)**：包含 `IntentVerificationTool` 和 `WatchdogAgent`，负责代码的生成、测试、验证和自愈。

---

## 🤝 贡献指南

本项目目前为私有原型验证项目。如需贡献，请联系作者 OpenDemon。

## 📄 许可证

MIT License

---
*Built with ❤️ by OpenDemon*
