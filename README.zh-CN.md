# Atms

[English](README.md) | 中文

Atms 是一个本地运行的 TypeScript Agent 编排运行时。你把自然语言请求交给 **Manager Agent**（一个能使用工具的 LLM）；它把工作规划成 **DAG**（有向无环图）并全程监督，而 **Worker 容器**负责在真实的 LLM 后端上执行每个节点。每次运行都是隔离的、可追踪、可重放的。

它运行在你自己的硬件上——笔记本、家用服务器或 NAS——并可以接入你指定的任意模型端点（Anthropic、OpenAI 兼容、本地 vLLM、Codex，或实验性的 DeepSeek harness）。

## 为什么用 DAG，而不是一个漫长的对话

单 Agent 对话是一个黑盒：上下文不断膨胀，工具调用与推理纠缠在一起，某一步失败就得从头再来。Atms 把这种模式翻转过来：

- **一次规划，多次执行。** Manager Agent 把请求拆解为带有显式交接（handoff）的节点。每个节点拥有独立的上下文窗口，完成自己的部分后把证据传递给下一个节点。
- **每个节点可以用不同模型。** 智能模型负责规划和评审，便宜快速的模型承担大部分工作。模板通过 per-agent 的 `provider` / `model` 映射来表达这一点。
- **默认可审计。** 每次运行都在 `${ATMS_HOME}/workspace/<run_id>/` 下保留工作区、执行轨迹、记分卡（scorecard）和评估报告。
- **可恢复。** 可以在持久化边界处暂停、从检查点恢复指定节点、在运行中注入新指令，或重放整个图。
- **人或 Agent 都可以驱动。** 可以从浏览器 UI 与之对话（语音或文本）、用 `atms` CLI 操作、或直接让一个 coding agent 驱动 CLI。

## 组成

| 组件 | 包 | 职责 |
| --- | --- | --- |
| Manager Agent | `atms_manager` | 基于 LLM 的规划/监督器。把请求转化为 DAG，监督执行，并回答关于运行的问题。 |
| DAG 运行时 | `atms_manager` | 执行引擎：调度、交接、按运行隔离的工作区、重放、记分卡、评估报告。 |
| Node | `atms_node` | 通过 Docker 创建 Worker 容器，每个 DAG 节点一个容器，同一次运行共享工作区。 |
| Worker | `atms_worker` | 执行节点。后端适配器：`claude-sdk`、`codex_appserver`、`kimi_code`、`deepseek_harness`，另有一个用于测试的离线确定性后端。 |
| Agent UI | `agent-ui` | Vue 3 浏览器界面：与 Manager Agent 聊天、语音座舱（ASR/TTS）、实时 DAG 画布、运行列表、设置、生成式组件。 |
| CLI | `atms_cli` | `atms` 命令——完整控制面（start、run、supervise、scorecard、replay、model config、plugin、credential……）。 |
| Protocol | `atms_protocol` | 共享的消息与校验契约——所有组件之间通信的单一事实来源。 |
| Plugins | `plugins/` | 内置与示例插件（生成式 UI、PR closeout、topic outline、release notes、video cover）。插件是带 schema、fixtures 和 skill 的可安装包。 |
| Skills | `skills/` | Manager Agent 自动发现的 `SKILL.md` 操作手册（`atms-cli`、`atms-dag-ops`、`atms-dag-patterns`、`atms-pr-review`、`atms-pr-closeout`……）。 |

## 快速开始

要求：

- Node.js 20+ 和 npm 10+
- Docker（Node 用它创建 Worker 容器）
- 至少一个 LLM 端点——一个模型 API key，或一个本地 OpenAI 兼容服务（vLLM、LM Studio……）

从本仓库安装并构建：

```bash
npm run install:all
npm run build
```

链接 CLI 并启动运行时：

```bash
cd atms_cli && npm link && cd ..
atms start
```

`atms start` 会启动 Manager（`http://localhost:19191`）和 Node。加上 `--ui` 会同时启动浏览器 Agent UI（HTTPS `https://localhost:19192`，HTTP 回退 `http://localhost:19193`）。在 Worker 需要通过 `host.docker.internal` 访问 Manager 的 Docker 环境中，请绑定 `0.0.0.0`：

```bash
atms start --host 0.0.0.0 --ui
```

检查就绪状态：

```bash
atms doctor
```

配置模型（凭据加密存储在 Manager 中，永远不会写入仓库文件）：

```bash
atms model configure <provider-or-endpoint-alias> \
  --endpoint-id <endpoint-id> \
  --model-name <model-id> \
  --api-key-stdin
atms model list
```

运行一次无模型的拓扑检查（离线确定性后端）：

```bash
atms run assets/orchestrations/public-two-node.yaml.template \
  --profile offline-deterministic \
  --prompt "Draft a short checklist for a backend release"
```

然后运行一个真实的五节点开发 DAG（plan → implement → test → review → summarize）并查看结果：

```bash
atms run assets/orchestrations/public-dev-5node.yaml.template \
  --prompt "Build a small static web page about coffee brewing"
atms dag supervise <run_id>
atms scorecard <run_id>
atms trace <run_id>
```

打开 `http://localhost:19193`，向 Manager Agent 提出一个任务——它会规划一个 DAG，你可以在实时画布上逐节点观察执行过程。

## 运行管理

`atms` CLI 是完整控制面：

```bash
atms run [template] [--workflow <id>] [--profile <id>] --prompt "..."   # 启动运行
atms runs                                                                # 列出运行
atms status <run_id>                                                     # 状态
atms stop <run_id>                                                       # 停止
atms dag supervise <run_id>                                              # 观察交接流程
atms scorecard <run_id>                                                  # 按节点记分卡
atms eval-run <run_id>                                                   # 评估报告
atms replay <run_id>                                                     # 重放计划
atms trace <run_id>                                                      # 执行轨迹
atms inject <run_id> <node_id> <instruction>                             # 向运行中的节点注入指令
atms resume <run_id> <node_id>                                           # 从检查点 fork + 恢复
```

工作流（workflow）和运行配置（profile）可以同步到 Manager 中复用：

```bash
atms dag sync assets/orchestrations/public-dev-5node.yaml.template
atms profile sync assets/profiles/example-runtime.profile.yaml.template --workflow <workflow_id>
atms run --workflow <workflow_id> --profile <profile_id> --prompt "..."
```

内置的 [DAG 模式库](docs/dag-patterns.md) 提供了可复用的控制流设计（quorum、bounded ratchet、持续目标验证、planner/worker fan-out）：

```bash
atms patterns list
atms patterns instantiate quorum --set workflow_id=release-quorum --set threshold=2
```

## 可复用的场景模板

`assets/orchestrations/` 包含开箱即用的模板：

- `public-two-node.yaml.template` — 最小双节点拓扑检查（可离线运行）
- `public-dev-5node.yaml.template` — plan → implement → test → review → summarize
- `auto-fix.yaml.template` / `auto-fix-v2.yaml.template` — GitHub issue → 修复 → PR 流水线
- `pr-review.yaml.template` / `pr-closeout.yaml.template` — 证据驱动的 PR 评审与收尾
- `workflow-spec-v1-*.yaml.template` — WorkflowSpec v1 控制流示例（condition、fanout、foreach、bounded while）
- `multi-actor-live-report.yaml.template` — 多 actor 实时报告

关于在持久化边界暂停、并在同一次运行下恢复选定 actor 的多轮工作流，见 [Multi-Round DAGs](docs/multi-round-dags.md)。关于在持久化 Linux 主机上无人值守运行 Auto Fix 和 PR 检查，见 [事件监督](docs/scenarios/event-supervision.md)。

## Agent 后端

每个 DAG 节点运行一个 worker 后端（在模板中按 agent 选择，带 `*` 兜底）：

| 后端 | 说明 |
| --- | --- |
| `claude-sdk` | Claude Agent SDK。默认的生产 worker 运行时。 |
| `codex_appserver` | OpenAI Codex。语音 Manager Agent 的推荐 harness——它能从模型的推理流自动合成口语化的 `commentary` 声道。 |
| `deepseek_harness` | 实验性。在进程外运行维护中的 DSH fork，并把其推理流映射为 Atms thinking 事件。见[集成文档](docs/architecture/deepseek-harness-integration.md)。 |
| `kimi_code` | Kimi Code 适配器。执行期间静默（提供商能力限制）。 |
| `deterministic` | 离线、非 LLM 后端，用于测试和拓扑检查。 |

就语音 Manager Agent 而言，目前推荐 `codex_appserver`；`claude-sdk` 和 `kimi_code` 执行期间静默，`deepseek_harness` 仍属实验性。

## 插件

插件是带 manifest（`atms.plugin.json`）、JSON schema、fixtures、UI projector 和 skill 的可安装包：

```bash
atms plugin list
atms plugin install <path-or-package>
```

内置插件：`core-generative-ui`、`pr-closeout`、`topic-outline`。`plugins/examples/` 中的示例：release notes 和 video cover（带离线测试用的 fake GPU runtime）。

## 开发

```bash
npm run typecheck          # 所有包
npm run build              # 所有包
npm run test               # 构建 + 完整测试套件
npm run ci                 # typecheck + build + test（CI 流水线）
npm run ci:local           # 在本地运行 Linux GitHub Actions 任务（需要 Docker、act、actionlint）
```

主要文档：

- [docs/architecture/](docs/architecture/) — durable DAG actors、deepseek-harness 集成、live steering、live surface projector
- [docs/dag-workflow-spec-v1-design.md](docs/dag-workflow-spec-v1-design.md) — WorkflowSpec v1
- [docs/control-plane-security.md](docs/control-plane-security.md) — 远程 Node/Worker 的认证 `wss://`
- [docs/worker-build-network.md](docs/worker-build-network.md) — 受限网络下的镜像源与代理
- [docs/production-deployment.md](docs/production-deployment.md) — 反向代理与公网 Origin

## 配置说明

- `ATMS_HOME`（默认 `~/.atms`）— 本地数据根目录：Manager 状态、运行工作区、日志。请指向有足够空间的磁盘；每次运行都会在 `${ATMS_HOME}/workspace/<run_id>/` 下累积产物。
- Worker 到 Manager 的网络 — Docker Desktop 上默认的 `host.docker.internal` 映射即可工作；Linux 上请使用 Docker `host-gateway` 或设置 `ATMS_MANAGER_WORKER_WS_BASE_URL`。不要硬编码网桥地址。
- 公网/反向代理访问 — `atms start --ui --public --ui-public-url https://atms.example.com`；Origin 必须是精确的 `http(s)` Origin。
- 捆绑 WebView 的 Android Live Voice 是 opt-in（`ATMS_ANDROID_LIVE_VOICE_ENABLED=1`），只应在受信任的局域网内启用。
