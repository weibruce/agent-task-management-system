---
name: atms-cli
description: |
  Exact Atms local-source TypeScript CLI command and configuration reference.
  Use when: (1) configuring or invoking the atms CLI from a local checkout,
  (2) listing orchestration templates, starting runs, checking status,
  (3) supervising DAG runs, inspecting chats/handoffs/scorecards,
  (4) injecting instructions or replaying runs, or (5) translating a known Atms operation into an exact atms command.
  For workflow topology selection use atms-dag-patterns; for multi-Actor Surface lifecycle and operational procedure use atms-dag-ops.
  For deployment, service startup, or skill installation, use atms-install-ops first.
---

# Atms CLI (TypeScript)

## Manager Agent native shell

The Atms Manager Agent can use the selected harness's native shell directly:
Codex provides its built-in shell and Claude Agent SDK provides `Bash`.

Prefer `atms --json <command...>` for structured results. If `atms` is not installed
on `PATH`, Atms exposes the active local-source entrypoint through
`ATMS_CLI_ENTRYPOINT`; invoke it as:

```bash
node "$ATMS_CLI_ENTRYPOINT" --json <command...>
```

A zero exit status plus the returned JSON is valid execution evidence. Dedicated
Manager Tools remain useful shortcuts, but the CLI is the complete control
surface for commands that have no dedicated Tool.

## Installation

Before acting, apply `atms-shared` rules. This pre-publication release uses the local source tree; do not assume npm publication exists.

```bash
cd atms_cli
npm ci
npm run build
```

The CLI binary is `dist/cli.js`. Run it directly or via the `atms` bin alias:

```bash
# From the repo root after build
node atms_cli/dist/cli.js --help

# Or link globally
cd atms_cli && npm link
atms --help
```

For development without a build step:

```bash
npx tsx atms_cli/src/cli.ts --help
```

## Configuration

Use the CLI config flow for local runtime settings and provider credentials:

```bash
atms config
atms config show
atms config apply
```

`atms config` writes non-secret settings under `${ATMS_HOME}/config.json`.
Provider and integration credentials are sent to Manager and stored in the
Manager encrypted settings store, persisted under
`${ATMS_HOME}/manager/atms.db`. `${ATMS_HOME}/secrets/env` is a
legacy plaintext import path only; do not use it as the normal OSS
configuration path.

The Manager URL is resolved in this order:

1. `--base-url <url>` flag on any command
2. `ATMS_MANAGER_URL` environment variable
3. `${ATMS_HOME}/config.json`
4. Default: `http://localhost:19191`

The default Manager port is `19191`. Override it with `ATMS_MANAGER_PORT` for
local service startup, or use a full `ATMS_MANAGER_URL` / `--base-url` when the
Manager is on another host or port.
The default Agent UI HTTPS port is `19192`. Override it with `ATMS_UI_PORT` or
`ui.port` in local config. The HTTP fallback port is `19193`; override it with
`ATMS_UI_HTTP_PORT` or `ui.httpPort`.

```bash
# Option A: environment variable
export ATMS_MANAGER_PORT=19191
export ATMS_MANAGER_URL=http://localhost:${ATMS_MANAGER_PORT}

# Option B: per-command flag
atms --base-url http://localhost:19191 templates list
```

Additional global options:

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON instead of formatted text |
| `--request-timeout <ms>` | HTTP request timeout (default: 30000) |

## Commands

### Local Runtime

```bash
# Interactive local config
atms config

# Start Manager and Node together
atms start
atms start --rebuild-worker-image
atms start --ui
atms start --ui --enable-text-mode

# Inspect and stop services started by atms start
atms runtime status
atms runtime logs
atms runtime stop

# Start and stop the decoupled Agent UI
atms ui start
atms ui start --enable-text-mode
atms ui status
atms ui logs
atms ui stop

# Check readiness
atms doctor
```

`atms start` is service-first: missing provider credentials should not prevent
Manager and Node from starting. `atms doctor` is the readiness gate that reports
missing model configuration and Manager Agent harness compatibility before DAGs
or Manager Agent smokes can run.
Use `--rebuild-worker-image` after changing `atms_worker` source so provisioned
DAG workers run the current checkout instead of a stale local Docker image.
Use `atms start --ui` or `atms ui start` to run the Agent UI. HTTPS is the
primary local endpoint (`https://localhost:19192`) and HTTP remains available as
a fallback (`http://localhost:19193`). The UI processes use
`${ATMS_HOME}/pids/ui-https.pid` / `${ATMS_HOME}/logs/ui-https.log` and
`${ATMS_HOME}/pids/ui.pid` / `${ATMS_HOME}/logs/ui.log`; `atms runtime stop`
also stops both.
Agent UI text mode is temporarily disabled by default, so `/agent` opens the
Voice Agent cockpit directly. Use `--enable-text-mode` only when restoring the
text Agent shell for local debugging.

### Templates and Runs

```bash
# List available orchestration templates
atms templates list
atms --json templates list

# Start a DAG run from a public YAML template path
atms run assets/orchestrations/public-two-node.yaml.template \
  --prompt "<prompt>"

# Sync a DAG asset to the Manager database. The YAML workflow_id is the stable
# identity; keep it unchanged during AI edits unless creating a new workflow/version.
atms dag sync assets/orchestrations/public-dev-5node.yaml.template

# Sync a DB-backed runtime profile. Profile YAML references model_alias or
# llm_setting_id, not provider/model.
atms profile sync assets/profiles/example-runtime.profile.yaml.template \
  --workflow public-dev-5node-template

# Run the database DAG instance with a server-side runtime profile
atms run \
  --workflow public-dev-5node-template \
  --profile example-runtime \
  --prompt "<prompt>"

# One-shot convenience: sync asset and profile YAML, then run the DB instance
atms run assets/orchestrations/public-dev-5node.yaml.template \
  --sync \
  --profile assets/profiles/example-runtime.profile.yaml.template \
  --prompt "<prompt>"

# Pin a specific database LLM setting for this run when needed
atms run assets/orchestrations/public-two-node.yaml.template \
  --setting-id <llm_setting_id> \
  --prompt "<prompt>"

# Run a read-only local harness deployment diagnosis from a fresh clone.
# The agent files an issue only when deployment is blocked.
atms run assets/orchestrations/local-harness-cli-deploy-diagnosis.yaml.template \
  --prompt "source_repo_url=<https git url> branch=main"

# List recent runs
atms runs

# Check run status
atms status <run_id>
atms --json status <run_id>

# Stop a running DAG
atms stop <run_id>
```

The deployment diagnosis template is a normal DAG. Do not start a fixed host
Worker and do not mount Docker into the Worker. The run should be provisioned
through Node like any other DAG, use its isolated workspace, clone the latest
source, build it, configure the cloned CLI to talk to the outer Manager, and
verify `runtime status` / `doctor`. The template uses advisory scorecard
enforcement, so scorecard findings should be reviewed separately from the
deployment result unless a template explicitly opts into strict enforcement.

### Smoke Gates

```bash
# Live DAG smoke through Manager create-and-run
atms smoke dag \
  --template assets/orchestrations/public-dev-5node.yaml.template

# Live Manager Agent smoke through /api/manager/chat
atms smoke manager-agent

# Validate a specific configured Manager Agent runtime
atms smoke manager-agent --setting-id <llm_setting_id>
atms smoke manager-agent --provider <provider_id> --model <model_name>
```

`smoke manager-agent` verifies the configured Manager Agent harness can call
Manager tools. It requires `/api/manager/chat` to return a real `run_id`, then
waits for the deterministic two-node DAG to reach `completed`.

### DAG Supervision and Inspection

```bash
# Cursor-based supervision (preferred for live monitoring)
atms dag supervise <run_id>

# Single tick with cursor (for agent-driven loops)
atms dag supervise <run_id> --tick --cursor <cursor>

# Interval polling watch
atms dag watch <run_id> --interval 5 --timeout 600

# Quick status snapshot
atms dag quick <run_id> --events 10

# Per-node chat and tool activity
atms dag chats <run_id> --tools 5
atms dag chats <run_id> --node node-a node-b
atms dag chats <run_id> --tools 20 --raw-tools

# Handoff content and contract checks
# --content-limit caps each handoff's content; default 500 truncates long JSON.
# Pass 0 (or a large value) to see the full review/summary payload.
atms dag handoffs <run_id> --content-limit 0
```

Use `--raw-tools` only for audit/debug. It prints redacted tool inputs and
result previews so an operator can verify CLI-first behavior, detect forbidden
Write/Edit/MultiEdit use, or spot direct API calls.
For local deep debugging only, Worker raw audit files are stored per run under
`${ATMS_HOME}/audit/tool-events/<run_id>.jsonl`; older installs may still have
legacy `${ATMS_HOME}/audit/tool-events.jsonl` archives.

### Evaluation and Reporting

```bash
# Run scorecard
atms scorecard <run_id>

# Evaluation report
atms eval-run <run_id> --events 5 --tools 3

# Replay log
atms replay <run_id>
```

Scorecard policies are advisory by default. `atms scorecard` still reports
findings, but `eval-run` only treats scorecard findings as gating failures when
the template declares `scorecard.enforcement: strict`.

### Utilities

```bash
# Configure the MiMo token-plan preset through local config
atms config
atms config apply

# List configured LLM providers
atms provider list

# Add or update a local custom provider catalog entry
atms provider upsert \
  --id <provider-id> \
  --name "<display name>" \
  --default-model <model-name> \
  --provider-base-url <provider-api-base-url>

# Show current LLM settings
atms llm-settings list

# Configure a realtime ASR model setting; read the key from stdin in real use
atms llm-settings add \
  --provider-id custom-asr-provider \
  --model-name realtime-asr-model \
  --display-name "Realtime ASR" \
  --endpoint-id custom_asr_realtime \
  --endpoint-name "Realtime ASR" \
  --plan-type custom \
  --protocol custom \
  --auth-type bearer \
  --model-base-url http://<asr-host>:5000 \
  --asr-realtime-url ws://<asr-host>:5002/v1/realtime \
  --supports-asr \
  --api-key-stdin

# Patch voice endpoint metadata without rebuilding the setting
atms llm-settings update <setting-id> \
  --asr-realtime-url ws://<asr-host>:5002/v1/realtime \
  --supports-asr \
  --no-supports-llm

# Show or switch the current Voice Agent runtime selection
atms voice show
atms voice configure \
  --recognition-mode asr \
  --asr-setting-id <asr-setting-id> \
  --tts-setting-id <tts-setting-id> \
  --llm-setting-id <llm-setting-id> \
  --tts-output-channel final \
  --tts-output-channel commentary
```

Do not configure an LLM-only model as ASR. Realtime ASR requires a separate
`supports_asr` setting that points at a realtime-capable endpoint. Batch ASR
remains a separate setting without a native realtime URL.

```bash
# Run statistics
atms stats

# Execution trace
atms trace <run_id>

# Inject an instruction into a running node
atms inject <run_id> <node_id> "<instruction>" --mode inbox
```

## Asset Discovery

The CLI sends the template path to the TS Manager API. Public examples use
`.yaml.template` files so users can copy them before adding local provider
profiles.

To discover available templates:

```bash
atms templates list
```

To inspect a template's structure, read the YAML file directly from
`assets/orchestrations/` in the repository.

Use `assets/orchestrations/local-harness-cli-deploy-diagnosis.yaml.template` for a
single-node, read-only local harness diagnosis run that clones fresh source, tries the
CLI deployment path on an isolated non-default Manager port, and creates a
deployment-blocker or coverage-blocker issue only on failure.

## DAG YAML Reference

Templates live in `assets/orchestrations/` and follow this minimal structure:

```yaml
name: my-pipeline
description: "Short description of the pipeline"

agents:
  my-agent:
    system: |
      You are a worker agent.
      When finished, call handoff(port="done", content=result).

nodes:
  step-a:
    name: "Step A"
    agent: my-agent
    after: []
    outputs:
      done:
        to: ""  # empty string = terminal node
```

Provider/model runtime selection comes from database LLM settings configured by
the CLI or settings UI. DB runtime profiles may select a default `model_alias`
or `llm_setting_id`, plus per-agent overrides and `agent_type`. YAML DAG
templates themselves must not contain provider/model/key/base_url runtime
fields. Supported public backend names include `claude-sdk`, `kimi-code`,
`kimi_code`, `codex_appserver`, and `deterministic`.
Do not use `direct-llm` or Chat Completions for Coding Plan / Agent Plan
accounts. Kimi should use the Kimi Code CLI harness (`kimi-code`); other
Coding Plan providers should use the Claude Code compatible harness
(`claude-sdk`) with an Anthropic-compatible endpoint.
Prefer hyphenated names in new YAML (`kimi-code`) unless you are preserving an
older template.

### Key Fields

| Field | Location | Description |
|-------|----------|-------------|
| `name` | top-level | Template display name shown by `atms templates list` |
| `agents.<key>.system` | agent | Inline system prompt |
| `agents.<key>.system_file` | agent | External prompt file (relative to YAML) |
| `nodes.<id>.agent` | node | Agent assignment |
| `nodes.<id>.after` | node | List of predecessor node IDs |
| `nodes.<id>.outputs.<port>.to` | node | Route target `"node.in:port"` or `""` for terminal |

## MCP Tools Available to DAG Agents

Each DAG agent receives these tools automatically:

| Tool | Purpose |
|------|---------|
| `handoff(port, content)` | Must be called when finished; hands off to downstream nodes |
| `send_message(to_node, content)` | Send a message to another node in the graph |
| `receive_message(timeout?)` | Block until a message arrives |
| `get_graph_context()` | Inspect current position in the DAG graph |
