# Atms

English | [中文](README.zh-CN.md)

Atms is a TypeScript runtime that turns one-off agent chats into auditable,
reusable workflows. The name comes from what it is: **Home** — it runs on your
own homelab, NAS, or home server, serving the people who live there; **Rail** —
the track shape of a DAG, where agent work flows node to node along explicit
edges instead of pooling in a single chat. The design bet is that a person's
attention is the scarcest resource in any automation, so the system should ask
for very little of it.

The long-term shape is a resident home-datacenter agent you talk to — voice in,
a generated interface out, a DAG of agents doing the work behind it. What is in
this tree today is the foundation it runs on: a DAG engine, a CLI, a voice
surface, and the first steps toward a generated UI.

## Why

Human bandwidth is narrow; the work we want done is not. Atms is shaped like
an inverted funnel that widens toward the machine:

- **Voice** — the preferred input, because it asks the least of you. You speak;
  the agent listens, confirms, and narrows ambiguity before doing anything. Text
  is always available too — for quiet settings, for precision, or for anyone not
  ready to talk to their computer yet.
- **Generative UI** — the agent does not dump logs or JSON at you. The interface
  is generated for the moment and shaped to be easy to read.
- **DAG** — the execution engine behind both. Multiple agents, multiple roles,
  multiple environments, with every handoff traced and every run replayable.

A chat session is a black box. A DAG is a graph you can inspect, replay, and
improve. Atms is what sits between the two — narrow where the person is,
wide where the machine is.

## What works today

- **DAG runtime** *(most mature)* — multi-agent orchestration with explicit
  handoffs, workspace isolation per run, replay, scorecards, and run evaluation.
- **CLI `atms`** — `start`, `config`, `doctor`, `run`, `smoke`, `dag supervise`,
  `scorecard`, `eval-run`, `replay`. The primary way to operate Atms.
- **Voice surface** — a Voice Surface Contract with ASR / TTS / VAD, Chinese by
  default. The agent collects intent
  across turns before acting.
- **Generative UI** *(in exploration)* — instead of dumping logs or JSON, the
  agent produces structured, generated views meant to be read at a glance. The
  shape of these views is still being designed through real use cases; the
  contract and the widget set will keep changing.
- **Docker Worker** — Manager and Node run as local services; Node uses Docker
  to provision Worker containers, one per DAG node, sharing a workspace per run.

## Hand this README to an agent

Atms is designed to be operated by agents as much as by people. This README
is written so that it doubles as an agent-readable runbook: the commands below
are plain `atms` invocations with self-describing names, and each step says what
to expect. You can hand the whole file to your agent (Claude Code, Codex, or
any tool that can run shell commands and read output) and ask it to install,
configure, and verify Atms on your machine following the Quickstart.

## Quickstart

Requirements:

- Node.js 20+ and npm 10+
- Docker, used by Node to provision Worker containers
- A Claude Agent SDK-compatible model endpoint for live agent runs

Platform notes:

- **macOS** — install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
  The default `host.docker.internal` mapping works out of the box.
- **Windows** — Docker Desktop (WSL 2 or Hyper-V backend both work), and run
  the CLI from Git Bash (or another POSIX-compatible shell). Some scripts
  assume a Unix-like shell and will not run correctly under `cmd.exe` or
  PowerShell.
- **Linux** — Docker Engine. Worker-to-Manager networking may need extra setup;
  see the [Configuration](#configuration) notes on Worker callback URLs.

Install and build from this source checkout:

```bash
npm run install:all
npm run build
```

Run the deterministic checks directly with `npm run ci`. To execute the Linux
GitHub Actions jobs locally, install Docker, [`act`](https://github.com/nektos/act),
and [`actionlint`](https://github.com/rhysd/actionlint), then run:

```bash
npm run ci:local
npm run ci:local -- core-linux  # run one job
```

The local runner covers the Linux core, UI coverage, and Docker smoke jobs. The
Windows job remains on GitHub's `windows-latest` runner.

The CLI is exposed as `atms`. Link it locally so the rest of this guide works as
written:

```bash
cd atms_cli && npm link && cd ..
atms --help
```

Start Manager and Node together. Manager becomes available without waiting for
Docker. Open **Settings → Runtime Environment** to check Docker, inspect Worker
versions, and build or rebuild `atms-worker:latest` asynchronously:

```bash
atms start
```

`atms start --rebuild-worker-image` queues the same asynchronous build after
Manager starts; it no longer blocks Manager startup while Docker builds.

Check readiness. `atms doctor` reports Manager reachability, Node availability,
the active model setting, and whether the Manager Agent harness can resolve a
runtime:

```bash
atms doctor
```

Run a local topology check. This uses the two-node template's offline
deterministic profile, so it does not need a model provider yet:

```bash
atms run assets/orchestrations/public-two-node.yaml.template \
  --profile offline-deterministic \
  --prompt "Draft a short checklist for a backend release"
```

The command returns a `run_id`; inspect it with `atms dag supervise <run_id>` if
you want to watch the handoff flow.

To also bring up the browser Agent UI:

```bash
atms start --ui
```

Defaults are Manager `http://localhost:19191`, Agent UI
`https://localhost:19192`, and HTTP fallback `http://localhost:19193`. The
Manager binds to `127.0.0.1` by default; use `atms start --host 0.0.0.0` only when
you intentionally want it reachable beyond localhost.

## Run a DAG

Load a template explicitly and run it:

```bash
atms templates list
atms run assets/orchestrations/public-two-node.yaml.template \
  --prompt "Draft a short project checklist"
```

For reusable workflows, sync the DAG into the Manager database. Keep
`workflow_id` stable when editing YAML; changing it creates a new workflow
identity.

```bash
atms dag sync assets/orchestrations/public-dev-5node.yaml.template
atms profile sync assets/profiles/example-runtime.profile.yaml.template \
  --workflow public-dev-5node-template
atms run \
  --workflow public-dev-5node-template \
  --profile example-runtime \
  --prompt "Draft a short project checklist"
```

Copy the returned `run_id`, then inspect it:

```bash
atms dag supervise <run_id>
atms scorecard <run_id>
atms eval-run <run_id>
```

For workflows that pause at a durable command boundary and resume selected
logical actors under the same run, see [Multi-Round DAGs](docs/multi-round-dags.md).
The guide covers strict WorkflowSpec v1 authoring, round fencing, CLI and HTTP
commands, recovery, expiry, and concurrency-slot behavior.

For a topology check without a live model provider, the two-node template ships
an offline deterministic profile:

```bash
atms run assets/orchestrations/public-two-node.yaml.template \
  --profile offline-deterministic \
  --prompt "Draft a short checklist for a backend release"
```

Atms also ships a Manager-backed [DAG pattern library](docs/dag-patterns.md)
for reusable control-flow designs such as quorum, bounded ratchets, standing
goal verification, and planner/worker fan-out:

```bash
atms patterns list
atms patterns show quorum
atms patterns instantiate quorum --set workflow_id=release-quorum --set threshold=2
```

Manager Agent discovers every `SKILL.md` directory under
`${ATMS_HOME:-$HOME/.atms}/skills` on each turn and installs missing
built-in `atms-*` skills there as links. A pattern request can therefore be
handled without shell commands: Manager Agent reads `atms-dag-patterns`,
selects and instantiates a catalog pattern, syncs it, and starts the returned
workflow through Manager tools.

## Drive the CLI from a coding agent

There is a second way to use Atms, beyond speaking to the Manager Agent or
typing commands yourself. A coding agent you already trust — Codex, Claude
Code, or any tool that can run shell commands — can drive the `atms` CLI
directly: `templates list`, `run`, `dag supervise`, `scorecard`, `replay`.

This skips the Manager Agent layer (the AI that plans a DAG from a request),
but not the Manager service (the DAG coordinator). Your coding agent takes over
the planning role: it reads a template, decides what to change, runs the DAG,
inspects the result, and iterates. This is the natural loop for developing and
debugging DAGs and templates — you get the full audit trail and evaluation of
the DAG runtime, with a model you already use for code in direct control of the
loop.

```text
you ↔ coding agent ↔ atms CLI ↔ Manager service ↔ DAG nodes
       (planning)              (coordination)     (execution)
```

The Manager Agent is still the right choice when you want Atms to plan and
run a workflow end-to-end from a single request, especially by voice. Driving
the CLI yourself is the right choice when you are building or tuning the DAG.

## Architecture

| Package | Role |
| --- | --- |
| `atms_protocol` | Shared message and validation contracts — single source of truth for runtime communication. |
| `atms_manager` | Manager service and DAG coordinator. Owns the voice surface and the generated-UI contract. |
| `atms_node` | Node service. Provisions Docker-backed Worker containers. |
| `atms_worker` | Worker runtime. Harness adapters for Claude Agent SDK and compatible agent backends. |
| `atms_cli` | The `atms` CLI. Configures, runs, and inspects DAG workflows. |
| `agent-ui` | Decoupled browser UI for operating the Manager. Renders voice surface and widgets. |

Manager and Node run as local services. Manager is not expected to run inside
the Worker image. Node creates Worker containers; Workers for one run share
`${ATMS_HOME}/workspace/<run_id>`.

### Smart brain, efficient workers

The expensive model should not do everything. Each DAG node runs in its own
context window: it receives the handoff it needs, does its part, and passes
evidence forward. Context never balloons into one giant thread, and nothing gets
compressed under pressure just to fit. Because nodes are independent, each can
use a different model — the smartest model plans and reviews; cheaper, more
token-efficient models do the bulk of the work. Templates express this through a
per-agent `provider` / `model` mapping, with a `"*"` wildcard as the fallback
default.

## Configuration

`ATMS_HOME` is the local data root — where Manager state, run workspaces,
logs, and the worker image cache land. It defaults to `~/.atms` and can grow
quickly: every DAG run writes its artifacts under
`${ATMS_HOME}/workspace/<run_id>/`, and these accumulate across runs. Point
it at a disk with room (a NAS mount, a large external volume) before you start
running real work:

```bash
export ATMS_HOME="/mnt/nas/atms"
```

Provider credentials are stored in the Manager encrypted settings store, never
in repo files. Configure a model from the provider catalog:

```bash
atms model configure <provider-or-endpoint-alias> \
  --endpoint-id <endpoint-id> \
  --model-name <model-id> \
  --api-key-stdin
atms model list
```

After a model is configured, run the full public smoke DAG. It exercises the
five-node path (plan → implement → test → review → summarize) and verifies both
scorecard and eval-run:

```bash
atms smoke dag \
  --template assets/orchestrations/public-dev-5node.yaml.template
```

A passing smoke writes its artifacts to the shared run workspace:

```text
${ATMS_HOME}/workspace/<run_id>/snake-game/index.html
${ATMS_HOME}/workspace/<run_id>/snake-game/TESTS.md
```

The CLI resolves the Manager URL in this order: `--base-url`,
`ATMS_MANAGER_URL`, `${ATMS_HOME}/config.json`, then
`http://localhost:19191`.

Android Live Voice access from the bundled WebView is disabled by default.
To opt in on a trusted LAN, set this variable in the Manager process environment
and start (or restart) Manager:

```bash
export ATMS_ANDROID_LIVE_VOICE_ENABLED=1
atms start --host 0.0.0.0 --ui
```

If Manager is already running, restart it after changing the environment.
Only the value `1` enables this exception. It allows the exact Origin
`https://appassets.androidplatform.net` for `POST /api/voice-agent/sessions/:id/live-ticket`
(including its preflight) and the ticket-authenticated `/api/voice-agent/sessions/:id/live`
WebSocket. Other Manager mutation endpoints keep their existing Origin rules;
this switch does not add the Android Origin to `ATMS_MANAGER_ADMIN_ORIGINS`.
Unset the variable or set it to `0` and restart to remove the exception.

The appassets domain is shared by Android apps using WebViewAssetLoader and is
not proof of a Atms installation. Enabling this switch permits any reachable
client using that Origin to obtain a Live Voice ticket and invoke the voice agent;
the short-lived ticket is not device authentication. Enable it only on a network
you trust, not an unprotected public Manager. An explicitly configured global
`ATMS_MANAGER_ADMIN_ORIGINS` entry remains authoritative even with this switch
off; remove any appassets entry there if you want default rejection.

For reverse-proxied public access, advertise external endpoints and bind the UI
to the machine IP:

```bash
atms start --ui --public \
  --public-url https://atms.example.com \
  --ui-public-url https://atms-ui.example.com
```

`--ui-public-url` (or `ATMS_UI_PUBLIC_URL`) must be an exact `http(s)`
Origin — no wildcard, path, query, fragment, or credentials. Atms rejects
anything else at startup instead of silently trusting a truncated Origin. The
same canonical Origin is shared with the Manager admin allowlist
(`ATMS_MANAGER_ADMIN_ORIGINS`) and with the static Agent UI proxy, which
authorizes protected UI mutations from either the explicitly configured public
Origin or a request-derived localhost/literal-IP Origin. Named LAN hosts such
as `atms.lan`, mDNS names, and custom domains must be pinned with
`--ui-public-url`; otherwise protected mutations and the browser-renderer ticket
fail closed with HTTP 403. This prevents an arbitrary DNS-rebinding Host from
being promoted to the trusted Manager proxy hop. `Forwarded` and
`X-Forwarded-*` headers are never trusted for this decision.

FN Connect (fnOS) rewrites the Host it forwards to Atms, so the browser
Origin no longer matches the internal Host. Configure the exact public Origin
the proxy presents:

```bash
# Browser loads https://atms.fn.example; FN Connect forwards the request
# to Atms with an internal Host such as 127.0.0.1:19192.
atms start --ui \
  --ui-public-url https://atms.fn.example
```

Generic Tailscale Serve / nginx / Caddy setups work the same way: terminate
TLS in the proxy, forward to the local Agent UI port, and configure the public
Origin:

```bash
atms start --ui --public \
  --ui-public-url https://atms.tail1234.ts.net
```

Worker containers connect back to the Manager through the URL Manager passes to
Node. On Docker Desktop the default `host.docker.internal` mapping is usually
enough; on Linux use Docker `host-gateway` support or set
`ATMS_MANAGER_WORKER_WS_BASE_URL`. Do not hardcode Docker bridge addresses.
Remote Worker and Node connections require authenticated `wss://` endpoints;
see [Control-Plane WebSocket Security](docs/control-plane-security.md) for token,
reverse-proxy, certificate, and compatibility settings.

Worker image builds default to the base image's Debian sources and the
default npm registry. Operators in restricted networks can opt in to public
mirrors with `ATMS_WORKER_BUILD_APT_MIRROR`,
`ATMS_WORKER_BUILD_APT_SECURITY_MIRROR`, and
`ATMS_WORKER_BUILD_NPM_REGISTRY`; standard `HTTP_PROXY`/`HTTPS_PROXY`/
`NO_PROXY` variables are forwarded to Docker by name only, and their values
are never captured by Atms. See
[Worker build network sources](docs/worker-build-network.md) for the
validation contract, security boundaries, and fnOS integration notes.

Runtime helpers:

```bash
atms runtime status
atms runtime logs
atms runtime stop
atms ui status
atms ui logs
atms ui stop
```

## Project direction

Atms is heading toward a resident agent on the home datacenter — voice in,
generated UI out, multiple nodes and terminals (phone, tablet, TV, car). The
foundation here is the first step; see [ROADMAP.md](ROADMAP.md) for the plan.

For the voice Manager Agent, **Codex (`codex_appserver`) is the recommended
harness today**: it is the only path that auto-synthesizes the `commentary`
speech channel from the model's native reasoning stream, so the user hears
progress while work happens. `claude-sdk` and `kimi-code` are silent during
execution — this is a provider capability gap, not something Atms can
close. An experimental `deepseek_harness` backend now runs the owner-maintained
[DSH fork](docs/architecture/deepseek-harness-integration.md) out of process and
maps its reasoning stream into Atms thinking events; it is not yet the
recommended Manager Agent runtime.

## License

MIT. See [LICENSE](LICENSE).

For unattended Auto Fix and PR checks, see [durable event supervision](docs/scenarios/event-supervision.md) for persistent Linux monitoring and result recovery.
