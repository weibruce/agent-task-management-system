#!/bin/bash
# ATMS startup with Docker group access
# Usage: ./start-atms.sh
cd /home/bruce/Documents/workspace/agent-tasks-manage-system

export ATMS_DSH_RUNTIME_BIN="/home/bruce/Documents/workspace/agent-tasks-manage-system/atms_worker/node_modules/@deepseek-ai/dsh/lib/bin.js"
export ATMS_MANAGER_ADMIN_ORIGINS="http://127.0.0.1:19193,http://localhost:19193,http://127.0.0.1:19192,http://localhost:19192,https://127.0.0.1:19192,https://localhost:19192"
# Map 127.0.0.1 to host-gateway in worker containers so LLM base_url (127.0.0.1:8080) works inside Docker
export ATMS_MANAGER_WORKER_EXTRA_HOSTS="127.0.0.1:host-gateway,host.docker.internal:host-gateway"
# Rootless Docker: socket path + host network (rootless docker 不支持 bridge 网络)
export DOCKER_HOST="unix:///run/user/1000/docker.sock"
export XDG_RUNTIME_DIR="/run/user/1000"
export ATMS_WORKER_NETWORK="host"
# 限制 worker 空闲回收时间（默认 5 分钟 → 1 分钟），减少闲置 DSH 子进程占用内存
export ATMS_DAG_WORKER_IDLE_TTL_MS=60000

atms start --host 0.0.0.0 --ui --enable-text-mode
