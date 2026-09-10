# Build from repo root: docker build -t atms-worker:latest -f atms_worker/Dockerfile .
FROM node:22-slim AS secret-guard-build

# Optional public Debian mirror overrides for Worker image builds. Unset
# values keep the base image defaults; the helper rewrites the deb822
# sources stanza by stanza before the first apt-get update.
ARG ATMS_WORKER_BUILD_APT_MIRROR
ARG ATMS_WORKER_BUILD_APT_SECURITY_MIRROR
COPY atms_worker/scripts/configure-apt-sources.mjs /opt/atms/scripts/configure-apt-sources.mjs
RUN node /opt/atms/scripts/configure-apt-sources.mjs

RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc libc6-dev \
  && rm -rf /var/lib/apt/lists/*
COPY atms_worker/native/codex-secret-guard.c /tmp/codex-secret-guard.c
RUN gcc -O2 -Wall -Wextra -Werror -fPIC -shared \
  -o /atms-codex-secret-guard.so /tmp/codex-secret-guard.c

FROM node:22-slim AS dsh-runtime-build

# Atms's owner-maintained DSH fork is pinned by immutable commit. The
# deploy closure is generated in this stage so the final Worker image does not
# depend on a source checkout or a package registry at runtime.
ARG ATMS_WORKER_BUILD_APT_MIRROR
ARG ATMS_WORKER_BUILD_APT_SECURITY_MIRROR
ARG NPM_CONFIG_REGISTRY
ARG ATMS_DSH_FORK_REPOSITORY=https://github.com/xiaotianfotos/deepseek-harness.git
ARG ATMS_DSH_FORK_COMMIT=f0fd50751713ab7e1b7cb1f13310a70c106d81b1
COPY atms_worker/scripts/configure-apt-sources.mjs /opt/atms/scripts/configure-apt-sources.mjs
RUN node /opt/atms/scripts/configure-apt-sources.mjs
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,id=atms-worker-npm-node22-v1,target=/root/.npm,sharing=locked \
  npm install --global corepack@0.34.0 --prefer-offline --no-audit --no-fund \
  && corepack enable
RUN git init /src/deepseek-harness \
  && cd /src/deepseek-harness \
  && git remote add origin "${ATMS_DSH_FORK_REPOSITORY}" \
  && git fetch --depth=1 origin "${ATMS_DSH_FORK_COMMIT}" \
  && git checkout --detach FETCH_HEAD \
  && test "$(git rev-parse HEAD)" = "${ATMS_DSH_FORK_COMMIT}"
WORKDIR /src/deepseek-harness
RUN --mount=type=cache,id=atms-worker-corepack-v1,target=/root/.cache/node/corepack,sharing=locked \
    --mount=type=cache,id=atms-worker-pnpm-node22-v1,target=/root/.local/share/pnpm/store,sharing=locked \
  if [ -n "${NPM_CONFIG_REGISTRY:-}" ]; then export COREPACK_NPM_REGISTRY="$NPM_CONFIG_REGISTRY"; fi \
  && corepack pnpm install --frozen-lockfile --prefer-offline \
  && corepack pnpm run build:lib:host \
  && corepack pnpm exec tsx scripts/build-exe-for-python-sdk.ts --skip-build --node-only

FROM node:22-slim

# Optional public Debian mirror overrides for Worker image builds. ARG
# declarations are stage-scoped, so they are repeated in this stage.
ARG ATMS_WORKER_BUILD_APT_MIRROR
ARG ATMS_WORKER_BUILD_APT_SECURITY_MIRROR
# Optional public npm registry override. Build-only: Docker exposes the ARG
# to every RUN npm operation in this stage without persisting a runtime ENV.
ARG NPM_CONFIG_REGISTRY

COPY atms_worker/scripts/configure-apt-sources.mjs /opt/atms/scripts/configure-apt-sources.mjs
RUN node /opt/atms/scripts/configure-apt-sources.mjs

WORKDIR /app
ENV PATH="/app/node_modules/.bin:${PATH}"
ENV ATMS_CODEX_PROC_GUARD="/usr/local/lib/atms-codex-secret-guard.so"
ARG ATMS_WORKER_VERSION
ARG ATMS_WORKER_PROTOCOL_VERSION
ARG ATMS_WORKER_SOURCE_FINGERPRINT=unknown
ARG ATMS_WORKER_IMAGE_REVISION=unknown
ENV ATMS_WORKER_VERSION="${ATMS_WORKER_VERSION}" \
    ATMS_WORKER_PROTOCOL_VERSION="${ATMS_WORKER_PROTOCOL_VERSION}" \
    ATMS_WORKER_SOURCE_FINGERPRINT="${ATMS_WORKER_SOURCE_FINGERPRINT}" \
    ATMS_WORKER_IMAGE_REVISION="${ATMS_WORKER_IMAGE_REVISION}"
ENV ATMS_DSH_RUNTIME_BIN="/opt/deepseek-harness-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js" \
    ATMS_DSH_CORDIS_CONFIG="/app/dsh/atms.cordis.yml"

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git openssh-client \
  && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,id=atms-worker-npm-node22-v1,target=/root/.npm,sharing=locked \
  npm install -g npm@11.6.2 --prefer-offline --no-audit --no-fund
COPY --from=secret-guard-build /atms-codex-secret-guard.so /usr/local/lib/atms-codex-secret-guard.so

# Copy atms_protocol to /atms_protocol (parallel to /app) so that
# file:../atms_protocol in atms_worker/package.json resolves correctly.
COPY atms_protocol/package.json atms_protocol/package-lock.json* /atms_protocol/
COPY atms_protocol/src /atms_protocol/src
COPY atms_protocol/tsconfig.json /atms_protocol/
RUN --mount=type=cache,id=atms-worker-npm-node22-v1,target=/root/.npm,sharing=locked \
  cd /atms_protocol && npm ci --prefer-offline --no-audit --no-fund
RUN --mount=type=cache,id=atms-worker-npm-node22-v1,target=/root/.npm,sharing=locked \
  cd /atms_protocol && npm run build

# Copy atms_worker
COPY atms_worker/package.json atms_worker/package-lock.json* ./
# --ignore-scripts skips postinstall since atms_protocol is already built above
RUN --mount=type=cache,id=atms-worker-npm-node22-v1,target=/root/.npm,sharing=locked \
  npm ci --ignore-scripts --prefer-offline --no-audit --no-fund
RUN command -v kimi
# npm treats the Claude SDK and Codex native platform payloads as optional, so
# a transient fetch failure can leave a successful install with unusable agent
# backends. Repair only the current Linux architecture at the exact pinned
# versions, without changing the image-owned package lock, then verify them.
RUN --mount=type=cache,id=atms-worker-npm-node22-v1,target=/root/.npm,sharing=locked \
  codex_arch="$(dpkg --print-architecture)" \
  && case "$codex_arch" in \
    amd64) codex_arch=x64 ;; \
    arm64) codex_arch=arm64 ;; \
    *) echo "Unsupported Codex Worker architecture: $codex_arch" >&2; exit 1 ;; \
  esac \
  && claude_version="$(node -p 'require("./node_modules/@anthropic-ai/claude-agent-sdk/package.json").version')" \
  && claude_platform="@anthropic-ai/claude-agent-sdk-linux-${codex_arch}" \
  && if [ ! -d "node_modules/${claude_platform}" ]; then \
    npm install --no-save --package-lock=false --ignore-scripts --prefer-offline --no-audit --no-fund \
      "${claude_platform}@${claude_version}"; \
  fi \
  && codex_version="$(node -p 'require("./node_modules/@openai/codex/package.json").version')" \
  && codex_platform="@openai/codex-linux-${codex_arch}" \
  && if [ ! -d "node_modules/${codex_platform}" ]; then \
    npm install --no-save --package-lock=false --ignore-scripts --prefer-offline --no-audit --no-fund \
      "${codex_platform}@npm:@openai/codex@${codex_version}-linux-${codex_arch}"; \
  fi \
  && test -x "node_modules/${claude_platform}/claude" \
  && command -v codex \
  && codex --version

# Auto Fix coding Workers run without network access. Keep a trusted dependency
# cache in the image for the Atms packages exercised by implementation and
# validation. Worker projects it only when the dependency-relevant normalized
# package.json + package-lock.json metadata matches these image-owned copies.
RUN mkdir -p /opt/atms-dependency-cache \
  && ln -s /atms_protocol /opt/atms-dependency-cache/atms_protocol \
  && ln -s /app /opt/atms-dependency-cache/atms_worker
COPY atms_plugin_sdk/package.json atms_plugin_sdk/package-lock.json* /opt/atms-dependency-cache/atms_plugin_sdk/
RUN --mount=type=cache,id=atms-worker-npm-node22-v1,target=/root/.npm,sharing=locked \
  cd /opt/atms-dependency-cache/atms_plugin_sdk && npm ci --prefer-offline --no-audit --no-fund
COPY atms_manager/package.json atms_manager/package-lock.json* /opt/atms-dependency-cache/atms_manager/
RUN --mount=type=cache,id=atms-worker-npm-node22-v1,target=/root/.npm,sharing=locked \
  cd /opt/atms-dependency-cache/atms_manager && npm ci --prefer-offline --no-audit --no-fund
COPY atms_node/package.json atms_node/package-lock.json* /opt/atms-dependency-cache/atms_node/
RUN --mount=type=cache,id=atms-worker-npm-node22-v1,target=/root/.npm,sharing=locked \
  cd /opt/atms-dependency-cache/atms_node && npm ci --prefer-offline --no-audit --no-fund
COPY atms_cli/package.json atms_cli/package-lock.json* /opt/atms-dependency-cache/atms_cli/
RUN --mount=type=cache,id=atms-worker-npm-node22-v1,target=/root/.npm,sharing=locked \
  cd /opt/atms-dependency-cache/atms_cli && npm ci --prefer-offline --no-audit --no-fund
COPY agent-ui/package.json agent-ui/package-lock.json* /opt/atms-dependency-cache/agent-ui/
RUN --mount=type=cache,id=atms-worker-npm-node22-v1,target=/root/.npm,sharing=locked \
  cd /opt/atms-dependency-cache/agent-ui && npm ci --ignore-scripts --prefer-offline --no-audit --no-fund

COPY atms_worker/tsconfig.json ./
COPY atms_worker/src ./src
COPY atms_worker/dsh ./dsh
COPY --from=dsh-runtime-build \
  /src/deepseek-harness/python/sdk-runtime/src/deepseek_harness_runtime/runtime/node \
  /opt/deepseek-harness-runtime
RUN --mount=type=cache,id=atms-worker-npm-node22-v1,target=/root/.npm,sharing=locked \
  npm run build

# Workspace checkouts can be created with owner-only source modes. Normalize
# only the copied metadata/config files the unprivileged runtime reads; npm and
# the DSH deploy step already materialize their output with public read modes.
RUN chmod a+r \
  /app/package*.json \
  /app/tsconfig.json \
  /app/dsh/atms.cordis.yml \
  /atms_protocol/package*.json \
  /atms_protocol/tsconfig.json \
  && find /opt/atms-dependency-cache -mindepth 2 -maxdepth 2 -type f \
    \( -name package.json -o -name package-lock.json \) -exec chmod a+r {} + \
  && mkdir -p /workspace \
  && chown -R node:node /workspace

USER node
WORKDIR /workspace

ENTRYPOINT ["env", "LD_PRELOAD=/usr/local/lib/atms-codex-secret-guard.so", "node", "/app/dist/index.js"]
