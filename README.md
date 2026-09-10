# Atms

English | [中文](README.zh-CN.md)

Atms is a local, TypeScript agent orchestration runtime. You hand a natural-language request to a **Manager Agent** (an LLM that can use tools); it plans the work as a **DAG** and supervises it while **Worker containers** execute each node against real LLM backends. Every run is isolated, traceable, and replayable.

It runs on your own hardware — a laptop, a home server, or a NAS — and talks to whatever model endpoints you point it at (Anthropic, OpenAI-compatible, local vLLM, Codex, or the experimental DeepSeek harness).

## Why a DAG instead of one long chat

A single agent chat is a black box: context balloons, tools and reasoning tangle together, and a failed step means starting over. Atms inverts that:

- **Plan once, execute many.** The Manager Agent decomposes a request into nodes with explicit handoffs. Each node gets a fresh context window, does its part, and passes evidence forward.
- **Different model per node.** Smart models plan and review; cheap, fast models do the bulk work. Templates express this with a per-agent `provider` / `model` mapping.
- **Auditable by default.** Every run keeps its workspace, execution trace, scorecard, and eval report under `${ATMS_HOME}/workspace/<run_id>/`.
- **Recoverable.** Pause at durable boundaries, resume a selected node from a checkpoint, inject a new instruction mid-run, or replay the whole graph.
- **Human- or agent-driven.** Talk to it from the browser UI (voice or text), operate it from the `atms` CLI, or let a coding agent drive the CLI directly.

## What you get

| Component | Package | Role |
| --- | --- | --- |
| Manager Agent | `atms_manager` | LLM-based planner/supervisor. Turns a request into a DAG, supervises it, and answers questions about runs. |
| DAG runtime | `atms_manager` | The execution engine: scheduling, handoffs, per-run workspaces, replay, scorecards, eval reports. |
| Node | `atms_node` | Provisions Docker Worker containers, one per DAG node, with per-run shared workspaces. |
| Worker | `atms_worker` | Executes a node. Backend adapters: `claude-sdk`, `codex_appserver`, `kimi_code`, `deepseek_harness`, plus a deterministic offline backend for testing. |
| Agent UI | `agent-ui` | Vue 3 browser surface: chat with the Manager Agent, voice cockpit (ASR/TTS), live DAG canvas, run list, settings, generative widgets. |
| CLI | `atms_cli` | The `atms` command — the full control surface (start, run, supervise, scorecard, replay, model config, plugin, credential…). |
| Protocol | `atms_protocol` | Shared message and validation contracts — the single source of truth between all components. |
| Plugins | `plugins/` | Built-in and example plugins (generative UI, PR closeout, topic outline, release notes, video cover). Plugins are installable packages with schemas, fixtures, and skills. |
| Skills | `skills/` | `SKILL.md` runbooks the Manager Agent discovers automatically (`atms-cli`, `atms-dag-ops`, `atms-dag-patterns`, `atms-pr-review`, `atms-pr-closeout`, …). |

## Quickstart

Requirements:

- Node.js 20+ and npm 10+
- Docker (Node uses it to provision Worker containers)
- At least one LLM endpoint — a model API key or a local OpenAI-compatible server (vLLM, LM Studio, …)

Install and build from this checkout:

```bash
npm run install:all
npm run build
```

Link the CLI and start the runtime:

```bash
cd atms_cli && npm link && cd ..
atms start
```

`atms start` launches Manager (`http://localhost:19191`) and Node. Add `--ui` to also serve the browser Agent UI (HTTPS `https://localhost:19192`, HTTP fallback `http://localhost:19193`). On Docker hosts where Workers must reach the Manager through `host.docker.internal`, bind to `0.0.0.0`:

```bash
atms start --host 0.0.0.0 --ui
```

Check readiness:

```bash
atms doctor
```

Configure a model (credentials are stored encrypted in Manager, never in repo files):

```bash
atms model configure <provider-or-endpoint-alias> \
  --endpoint-id <endpoint-id> \
  --model-name <model-id> \
  --api-key-stdin
atms model list
```

Run a topology check with no live model (offline deterministic backend):

```bash
atms run assets/orchestrations/public-two-node.yaml.template \
  --profile offline-deterministic \
  --prompt "Draft a short checklist for a backend release"
```

Then run a real five-node development DAG (plan → implement → test → review → summarize) and inspect the result:

```bash
atms run assets/orchestrations/public-dev-5node.yaml.template \
  --prompt "Build a small static web page about coffee brewing"
atms dag supervise <run_id>
atms scorecard <run_id>
atms trace <run_id>
```

Open `http://localhost:19193` and ask the Manager Agent to do something — it will plan a DAG and you can watch it execute node by node on the live canvas.

## Operating a run

The `atms` CLI is the full control surface:

```bash
atms run [template] [--workflow <id>] [--profile <id>] --prompt "..."   # start a run
atms runs                                                                # list runs
atms status <run_id>                                                     # status
atms stop <run_id>                                                       # stop
atms dag supervise <run_id>                                              # watch the handoff flow
atms scorecard <run_id>                                                  # per-node scorecard
atms eval-run <run_id>                                                   # evaluation report
atms replay <run_id>                                                     # replay plan
atms trace <run_id>                                                      # execution trace
atms inject <run_id> <node_id> <instruction>                             # steer a running node
atms resume <run_id> <node_id>                                           # fork + resume from checkpoint
```

Workflows and profiles are synced into Manager for reuse:

```bash
atms dag sync assets/orchestrations/public-dev-5node.yaml.template
atms profile sync assets/profiles/example-runtime.profile.yaml.template --workflow <workflow_id>
atms run --workflow <workflow_id> --profile <profile_id> --prompt "..."
```

A [DAG pattern library](docs/dag-patterns.md) ships with reusable control-flow designs (quorum, bounded ratchets, standing goal verification, planner/worker fan-out):

```bash
atms patterns list
atms patterns instantiate quorum --set workflow_id=release-quorum --set threshold=2
```

## Reusable scenario templates

`assets/orchestrations/` contains ready-to-run templates:

- `public-two-node.yaml.template` — minimal two-node topology check (works offline)
- `public-dev-5node.yaml.template` — plan → implement → test → review → summarize
- `auto-fix.yaml.template` / `auto-fix-v2.yaml.template` — GitHub issue → fix → PR pipeline
- `pr-review.yaml.template` / `pr-closeout.yaml.template` — evidence-driven PR review and closeout
- `workflow-spec-v1-*.yaml.template` — WorkflowSpec v1 control-flow examples (condition, fanout, foreach, bounded while)
- `multi-actor-live-report.yaml.template` — multi-actor live reporting

For multi-round workflows that pause at durable boundaries and resume selected actors under the same run, see [Multi-Round DAGs](docs/multi-round-dags.md). For unattended Auto Fix and PR checks on a durable Linux host, see [event supervision](docs/scenarios/event-supervision.md).

## Agent backends

Each DAG node runs one of the worker backends (selected per agent in the template, with a `*` fallback):

| Backend | Notes |
| --- | --- |
| `claude-sdk` | Claude Agent SDK. Default production worker runtime. |
| `codex_appserver` | OpenAI Codex. Recommended for the voice Manager Agent — it auto-synthesizes the spoken `commentary` channel from the model's reasoning stream. |
| `deepseek_harness` | Experimental. Runs the owner-maintained DSH fork out of process and maps its reasoning stream into Atms thinking events. See [integration docs](docs/architecture/deepseek-harness-integration.md). |
| `kimi_code` | Kimi Code adapter. Silent during execution (provider capability gap). |
| `deterministic` | Offline, non-LLM backend for tests and topology checks. |

For the voice Manager Agent specifically, `codex_appserver` is the recommended harness today; `claude-sdk` and `kimi_code` are silent during execution, and `deepseek_harness` is still experimental.

## Plugins

Plugins are installable packages with a manifest (`atms.plugin.json`), JSON schemas, fixtures, UI projectors, and skills:

```bash
atms plugin list
atms plugin install <path-or-package>
```

Built-ins: `core-generative-ui`, `pr-closeout`, `topic-outline`. Examples in `plugins/examples/`: release notes and video cover (with a fake GPU runtime for offline testing).

## Development

```bash
npm run typecheck          # all packages
npm run build              # all packages
npm run test               # build + full test suite
npm run ci                 # typecheck + build + test (CI pipeline)
npm run ci:local           # run the Linux GitHub Actions jobs locally (needs Docker, act, actionlint)
```

Key documentation:

- [docs/architecture/](docs/architecture/) — durable DAG actors, deepseek-harness integration, live steering, live surface projector
- [docs/dag-workflow-spec-v1-design.md](docs/dag-workflow-spec-v1-design.md) — WorkflowSpec v1
- [docs/control-plane-security.md](docs/control-plane-security.md) — authenticated `wss://` for remote Nodes/Workers
- [docs/worker-build-network.md](docs/worker-build-network.md) — mirrors and proxies for restricted networks
- [docs/production-deployment.md](docs/production-deployment.md) — reverse proxies, public origins
- [ROADMAP.md](ROADMAP.md) — where the project is heading

## Configuration notes

- `ATMS_HOME` (default `~/.atms`) — local data root: Manager state, run workspaces, logs. Point it at a disk with room; every run accumulates artifacts under `${ATMS_HOME}/workspace/<run_id>/`.
- Worker-to-Manager networking — on Docker Desktop the default `host.docker.internal` mapping works; on Linux use Docker `host-gateway` or set `ATMS_MANAGER_WORKER_WS_BASE_URL`. Don't hardcode bridge addresses.
- Public/reverse-proxied access — `atms start --ui --public --ui-public-url https://atms.example.com`; the Origin must be an exact `http(s)` Origin.
- Android Live Voice from the bundled WebView is opt-in (`ATMS_ANDROID_LIVE_VOICE_ENABLED=1`) and should only be enabled on a trusted LAN.

## License

MIT. See [LICENSE](LICENSE).
