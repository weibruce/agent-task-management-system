#!/bin/bash
# ATMS startup with Docker group access
# Usage: ./start-atms.sh
cd /home/bruce/Documents/workspace/agent-tasks-manage-system

export ATMS_DSH_RUNTIME_BIN="/home/bruce/Documents/workspace/agent-tasks-manage-system/atms_worker/node_modules/@deepseek-ai/dsh/lib/bin.js"
export ATMS_MANAGER_ADMIN_ORIGINS="http://127.0.0.1:19193,http://localhost:19193,http://127.0.0.1:19192,http://localhost:19192,https://127.0.0.1:19192,https://localhost:19192"
# Map 127.0.0.1 to host-gateway in worker containers so LLM base_url (127.0.0.1:8080) works inside Docker
export ATMS_MANAGER_WORKER_EXTRA_HOSTS="127.0.0.1:host-gateway,host.docker.internal:host-gateway"
# Custom Docker network for worker containers (gateway 172.18.0.1 reaches host services)
export ATMS_WORKER_NETWORK="atms-net"

# Use sg to run with docker group
exec sg docker -c "atms start --host 0.0.0.0 --ui --enable-text-mode"
