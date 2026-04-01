# Claude-ACE (Claude 省钱版)

> 节约 90% Token 消耗，支持 OpenAI 及国产大模型接口的下一代 AI 编程助手。

Claude-ACE (Adaptive Context Engine) 是一个从第一性原理出发构建的 AI 编程助手。它以 Anthropic 官方发布的 Claude Code 源码为基线进行深度重构，通过引入**活体语义图谱**、**自我修复能力**、**意图验证闭环**等机制，彻底解决了传统 AI 编程助手过度消耗 Token、强绑定单一模型等痛点。

![Claude-ACE Startup](docs/screenshots/startup.png)

---

## 🎯 核心亮点

### 💰 极致省钱：Token 消耗直降 90%
彻底抛弃低效的文本全量读取（Grep/Cat），使用 Tree-sitter 提取代码的 AST 骨架，并通过 `ExpandSymbolTool` 实现"按需展开"。

![Token Saving Strategies](docs/screenshots/token-saving.png)

#### 详细 Token 节约对照表 (实测数据)

| 任务场景 | 传统全量读取 (Claude Code) | Claude-ACE (骨架+按需展开) | 节约比例 |
|---------|-------------------------|--------------------------|---------|
| **理解大文件架构** (2000行) | ~4,500 tokens | ~450 tokens | **~90%** |
| **查找特定函数逻辑** | 2,521 tokens | 1,106 tokens | **56.1%** |
| **理解模块职责** | 2,497 tokens | 849 tokens | **66.0%** |
| **处理超大复杂文件** (1144行) | 182,843 tokens | 28,372 tokens | **84.5%** |

*注：文件越大，骨架压缩比越高，节约效果越明显。*

### 🌐 模型自由：支持 OpenAI 与国产大模型
不再强绑定 Anthropic 的 Claude 模型。Claude-ACE 默认支持任何兼容 OpenAI API 格式的大模型接口，让你自由选择性价比最高的模型。

#### 支持的模型提供商及配置参考

| 提供商 | 申请地址 | 环境变量 `OPENAI_BASE_URL` | 推荐模型 (`OPENAI_MODEL`) |
|--------|----------|---------------------------|---------------------------|
| **智谱 GLM** | [申请 API Key](https://bigmodel.cn/) | `https://open.bigmodel.cn/api/paas/v4/` | `glm-5-turbo` (推荐) / `glm-4-flash` (免费) |
| **通义千问** | [申请 API Key](https://bailian.console.aliyun.com/) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-turbo` / `qwen-max` / `qwen-coder-plus` |
| **DeepSeek** | [申请 API Key](https://platform.deepseek.com/) | `https://api.deepseek.com/v1` | `deepseek-chat` / `deepseek-reasoner` |
| **MiniMax** | [申请 API Key](https://platform.minimaxi.com/) | `https://api.minimax.chat/v1` | `MiniMax-Text-01` / `abab6.5s-chat` |
| **Kimi** | [申请 API Key](https://platform.moonshot.cn/) | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` / `moonshot-v1-32k` |
| **OpenAI** | [申请 API Key](https://platform.openai.com/) | `https://api.openai.com/v1` | `gpt-4o-mini` / `gpt-4o` |

*提示：在 Claude-ACE 运行中，你可以随时使用 `/model <模型名称>` 命令无缝切换模型，无需重启。*

---

## 🚀 五大核心能力 (v0.7.0 完整集成)

| 维度 | Claude Code | Claude-ACE | 核心突破 |
|------|-------------------|--------------------|----------|
| **一：上下文理解** | 文本检索 (Grep/Glob) | **活体系统语义图谱** | AST 骨架 + 按需展开 + `CallGraph` 蝴蝶效应分析，Token 直降 **90%** |
| **二：运行模式** | 被动唤醒的 REPL | **主动演化与自我修复** | 后台 `Watchdog` 守护进程，真实运行 `npm test` 并自动修复 |
| **三：代码生成** | 直接修改 → 报错 → 重试 | **意图驱动的验证闭环** | 意图 → 测试 → 实现 → 自愈，骨架失败自动降级全量上下文 |
| **四：架构思维** | 顺从的"打字员" | **批判性思维架构师** | `CriticalArchitect` 拒绝糟糕设计，主动提供安全/性能更优的建议 |
| **五：知识积累** | 仅限当前项目上下文 | **跨维度工程直觉** | `CrossProjectMemory` 持久化跨项目记忆 + 三问质量门控 |

---

## 🛠️ 快速开始

### 环境要求
- Node.js >= 18
- 兼容 OpenAI 格式的 API Key

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/OpenDemon/claude-ace.git
cd claude-ace

# 2. 安装依赖
npm install

# 3. 配置环境变量（以智谱 GLM 为例）
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://open.bigmodel.cn/api/paas/v4/"
export OPENAI_MODEL="glm-5-turbo"

# 4. 启动 Claude-ACE
npm start
```

### 丰富的斜杠命令菜单

Claude-ACE 提供了对标 Claude Code 的完整 TUI 交互体验，输入 `/` 即可弹出交互式菜单：

![Slash Commands](docs/screenshots/help.png)

---

## 📚 架构设计

Claude-ACE 的核心架构分为三层，共 10 个核心工具：

```text
┌─────────────────────────────────────────────────────────────┐
│                    Claude-ACE Agent Loop                    │
├──────────────────┬──────────────────┬───────────────────────┤
│  感知层           │  决策层           │   执行层              │
│  (Perception)    │  (Reasoning)     │   (Execution)         │
│                  │                  │                       │
│ SemanticSearch   │ CriticalArchitect│ IntentVerify          │
│ FileRead (ACE)   │ CrossProjectMemory  BashTool             │
│ ExpandSymbol     │ WatchdogAgent    │ FileWrite             │
│ CallGraph        │                  │ GrepTool              │
└──────────────────┴──────────────────┴───────────────────────┘
```

1. **感知层 (Perception)**：将物理文件转化为结构化语义图谱，支持按需展开和调用图（Call Graph）影响分析。
2. **决策层 (Reasoning)**：在修改代码前进行架构评估，并检索高质量的历史调试经验。
3. **执行层 (Execution)**：基于意图生成测试，代码必须通过测试才会被接受；后台 Watchdog 持续守护代码库健康。

---

## 📝 版本历史

### v0.8.0（当前版本）
- **全面扩展国产模型支持**：内置通义千问、DeepSeek、MiniMax、Kimi 等主流国产模型配置。
- **智能环境诊断**：`/doctor` 命令自动识别当前模型提供商，并提供针对性的配置检查与修复建议。
- **动态费用估算**：`/cost` 命令支持所有新接入模型的价格计算。
- **分组模型列表**：`/model` 命令按提供商分组展示可用模型及价格信息。

### v0.7.0
- **完整 CLI 体验**：补全 19 个斜杠命令（`/status`, `/skills`, `/resume`, `/memory`, `/watchdog`, `/callgraph`, `/model`, `/compact`, `/export`, `/init`, `/doctor`, `/cost` 等）。
- **会话持久化**：启动界面展示 Recent Activity，支持本地保存、恢复和重命名对话。
- **流式交互**：打字机效果输出，Markdown 实时渲染与代码高亮。

### v0.3.0
- **全面集成**：10 个核心工具全部接入 Agent 主流程，五大维度形成完整闭环。
- **新增 `CallGraphTool`**：基于 AST 的调用图分析，支持 `callees`、`callers` 和 `impact`（蝴蝶效应分析）。
- **升级 `WatchdogAgent`**：真实运行 `npm test` 和 `eslint`，自动捕获并修复真实错误。

### v0.2.0
- **新增 `ExpandSymbolTool`**：骨架模式下按需展开任意函数完整实现，防止幻觉。
- **升级 `IntentVerificationTool`**：新增 Fallback 策略，骨架失败自动降级为全量上下文。
- **升级 `CrossProjectMemory`**：引入三问质量门控机制，拒绝通用知识，只存高价值经验。

### v0.1.0
- 五大维度初始原型实现。
- 真实 LLM API 回测：Token 消耗降低 84.5%。

---

## 🤝 致谢

- [sanbuphy/claude-code-source-code](https://github.com/sanbuphy/claude-code-source-code) — Claude Code 源码提取
- [zxdxjtu/claude-code-sourcemap](https://github.com/zxdxjtu/claude-code-sourcemap) — 修复内部依赖的可运行版本
- [Yeachan-Heo/oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) — Learner Skill 质量门控设计启发

---

## 📄 许可证

MIT License

---
*Built with ❤️ by OpenDemon*
