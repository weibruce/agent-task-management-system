# Atms RAG 长期记忆 — 开发需求说明

> 版本 v1.0 · 2026-09-10 · 状态：待开发
> 目标读者：Atms 维护者（Bruce）· 配套文档：`README.md`、`docs/architecture/durable-dag-actors.md`、`docs/dag-patterns.md`

---

## 1. 背景与动机

Atms 的 Manager Agent 和 Voice Agent 现在拥有 **线性全量会话上下文**：
`agent-sessions.ts` 用 `sessions` / `session_messages` 两张 SQLite 表按 sequence
顺序存对话，`loadMessages` 每次把整段历史塞回给 LLM。

同时 Atms 已有一层 **结构化 memory 基础设施**：

| 现有设施 | 文件 | 作用 |
| --- | --- | --- |
| `memories` 表 | `persistence/db.ts` | `user_id / kind / last_accessed / data` 结构化记忆 |
| `experience_ingest_jobs` 表 | `persistence/experience-ingest-jobs.ts` | 经验采集任务管道 |
| `experience_nodes` / `experience_relationships` 表 | `persistence/db.ts` | 经验图（节点 + 关系） |

**缺口**：这一层 memory 只能做 **结构化 / 关键词** 读取，没有 **语义（vector）检索**。
也就是说，"用户上周提过的那个数据管道需求"这种**语义相关**的内容，现在无法被按需召回。
当会话历史或经验库增长后，全量上下文会超出窗口、噪声增多、相关片段被稀释。

**RAG（Retrieval-Augmented Generation）** 补的正是这个缺口：把内容切成 chunk、
存 embedding、查询时算相似度召回 top-k、注入 prompt，让 LLM **按需**看到最相关的长期记忆，
而不是把全部历史硬塞进去。

---

## 2. 现状与约束（基于真实代码，已核实）

| 项 | 现状 | 对 RAG 的影响 |
| --- | --- | --- |
| DB | `better-sqlite3`，版本化迁移 `schema_migrations`（已至 30+） | RAG 表走标准迁移，新分配 id |
| 会话层 | `agent-sessions.ts`（`sessions`/`session_messages`） | 注入点：`loadMessages` 之后 |
| 现有 memory | `memories` + `experience_*` 表 + `experience-ingest-jobs.ts` | RAG 是其**向量检索增强**，不替换 |
| LLM backend | claude-sdk / codex_appserver / kimi / deepseek（`atms_worker`） | embedding 走独立本地路径，不依赖 worker |
| 运行时 | Node **v26.7.0**，TypeScript，`vitest` | 可选 WASM 向量索引；测试框架现成 |
| 网络 | HuggingFace **可达（HTTP 200）**，可下载模型 | 本地 embedding 模型可拉取并缓存 |
| 安全 | control-plane wss 认证、credential redaction 在 Manager 信任边界 | RAG 内容入库前走 redaction，不存凭据 |
| 定位 | local / self-hosted，不依赖外部 SaaS | embedding **纯本地**，不联网调用 API |

**硬约束（不可违反）**

- RAG 必须 **local / self-hosted**：embedding 在本地跑，不调用云端 embedding API。
- 复用现有 SQLite，**不引入新数据库进程**（向量索引可选 WASM，进程内）。
- 入库内容必须先过现有 **credential redaction**，不存任何密钥。
- 不破坏现有 `agent-sessions` 与 `experience_*` 的读写契约（RAG 是新增读取层）。
- 迁移必须 **幂等**，沿用 `schema_migrations` 链。

---

## 3. 目标与非目标

### 3.1 目标（In Scope）

- 本地 embedding 服务：把文本转成固定维度向量，进程内、可缓存模型。
- 向量存储：在 SQLite 中建 chunk 表，存内容 + embedding + 元数据。
- 切分策略：把会话历史 / 经验条目切成可检索的 chunk。
- 检索：对查询做 embedding，召回 top-k 最相关 chunk（cosine 相似度）。
- 注入：把召回片段拼进 Manager Agent / Voice Agent 的上下文（system / 前置消息）。
- 写入：会话结束 / 经验采集时，把值得长期保留的内容 embed 入库。
- 评估：用 eval 机制衡量检索质量（命中率、相关片段是否被召回）。
- CLI + API：`atms memory search/ingest/stats` 与对应 HTTP 端点。
- 测试：vitest 覆盖 chunk、embed、检索、注入、redaction、迁移。

### 3.2 非目标（Out of Scope，本期不做）

- 多租户 / 跨用户隔离（Atms 是单用户本地系统）。
- 实时流式更新向量索引（本期批式写入足够）。
- 图 RAG / 多跳推理（`experience_relationships` 已有图，但语义图检索留到后续）。
- 分布式向量数据库（Chroma / LanceDB 留作可选演进，见 §10）。
- 跨语言 / 多模态 embedding（本期只做文本）。

---

## 4. 技术选型

### 4.1 Embedding 模型（推荐 + 备选）

| 选项 | 模型 | 维度 | 运行方式 | 取舍 |
| --- | --- | --- | --- | --- |
| **推荐** | `Xenova/all-MiniLM-L6-v2`（sentence-transformers） | 384 | `@xenova/transformers`（ONNX Runtime Web，WASM，纯 JS） | 无 native 编译、CPU 可跑、HF 可下载、足够快、本地 |
| 备选 A | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | 384 | 同上 | **中英混合**更好（Atms 内容含中文），模型稍大 |
| 备选 B | `bge-small-zh-v1.5` / `bge-m3` | 512/1024 | 需 local vLLM / TEI 服务 | 中文最强，但引入外部模型服务进程 |
| 不推荐 | OpenAI / Anthropic embeddings API | — | 云端 HTTP | 违反 local 定位，联网 + 花钱 |

**决策建议**：
- 若 Atms 内容以**中文为主**（你的场景很可能是）→ 直接上**备选 A 多语言 MiniLM**，
  一个模型同时覆盖中英，省得后续再换。
- 若以英文为主 → 推荐项 `all-MiniLM-L6-v2`。
- 两个都是 `@xenova/transformers` 可跑，切换只改模型 id，**架构不变**。

> 落地前先跑一次真实基准：对 ~200 条中文 + 英文样本，量测单条 embed 耗时与召回质量，
> 用数据决定最终模型，不拍脑袋。

### 4.2 向量存储与检索

| 规模 | 方案 | 说明 |
| --- | --- | --- |
| chunk < ~5 万（本期） | **SQLite 存 embedding BLOB + 进程内暴力 cosine** | 零新依赖、可解释、够快；冷启动把向量载入内存 |
| chunk > ~5 万（后续） | 引入 **HNSWlib / USearch（WASM）** 进程内索引 | 仍 local、无新进程；SQLite 做持久层，WASM 做加速层 |

**本期采用左列**（暴力 cosine + 内存缓存），右列作为明确的可演进路径，
在接口层预留 `VectorIndex` 抽象，避免将来换实现时大改。

### 4.3 技术栈映射（与现有 Atms 一致）

- 语言：TypeScript（与 Manager 同栈）。
- DB：`better-sqlite3`（复用 `getDb()`）。
- 测试：`vitest`（复用现有配置）。
- 模型：`@xenova/transformers`（新增依赖，仅 Manager 侧）。
- 协议：embedding 向量用 `Float32Array` 内存传递，落库为 `BLOB`。

---

## 5. 架构设计

### 5.1 分层

```
┌─────────────────────────────────────────────────────────────┐
│  消费层  Manager Agent · Voice Agent · CLI · HTTP API         │
│          (在 loadMessages 之后注入召回片段)                    │
├─────────────────────────────────────────────────────────────┤
│  检索层  MemoryRetriever                                      │
│          query → embed → VectorIndex.search(topK) → chunks   │
├─────────────────────────────────────────────────────────────┤
│  索引层  VectorIndex (interface)                              │
│          ├─ BruteForceIndex  (本期: 内存 BLOB + cosine)       │
│          └─ HnswIndex        (后续: USearch/HNSWlib WASM)     │
├─────────────────────────────────────────────────────────────┤
│  嵌入层  EmbeddingService (interface)                         │
│          └─ XenovaEmbedder  (@xenova/transformers, 本地)      │
├─────────────────────────────────────────────────────────────┤
│  切分层  Chunker                                               │
│          会话历史 / 经验条目 → 定长 + 重叠 chunk               │
├─────────────────────────────────────────────────────────────┤
│  存储层  memory_chunks 表 (SQLite)                             │
│          id · scope · session_id · content · embedding BLOB   │
│          · metadata · created_at                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 数据流

**写入（ingest）**
1. 触发：会话 `closeSession` / 经验采集管道完成 / 手动 `atms memory ingest`。
2. 选内容：从会话历史或 `experience_nodes` 取**值得长期保留**的文本
   （过滤纯工具噪声、过短片段、重复内容）。
3. Redaction：走现有 credential redactor，确保无密钥。
4. Chunk：`Chunker` 切成 `size=512 token`、`overlap=64` 的块。
5. Embed：`EmbeddingService` 批量转向量。
6. 落库：插入 `memory_chunks`（幂等：同 scope+content hash 不重复）。
7. 索引：`VectorIndex` 增量加新向量。

**读取（retrieve）**
1. 触发：Manager / Voice Agent 每轮构造上下文时。
2. 查询 embed：`EmbeddingService` 把当前 query 转向量。
3. 召回：`VectorIndex.search(queryVec, topK=5, scope=当前 session/project)`。
4. 过滤：按相似度阈值（默认 cosine ≥ 0.35，可调）+ scope 过滤。
5. 注入：把 top-k 片段（带出处 + 相似度）拼进 system prompt 的
   `<long_term_memory>` 块，置于近期线性上下文**之前**。
6. 反馈：记录本次召回（供 §8 评估）。

### 5.3 与现有 memory 层的关系

RAG **不替换** `memories` / `experience_*`，而是给它们加 **semantic 检索面**：
- 结构化精确读取（按 `user_id`/`kind`）仍走原路径。
- 语义召回走 `memory_chunks`（内容来源可以是会话历史，也可以是 `experience_nodes`）。
- 两者互补：结构化 = 我知道"存过这条"；RAG = 我知道"这条和当前问题相关"。

---

## 6. 数据模型

### 6.1 新表 `memory_chunks`（新 schema 迁移，id 续 30+ 之后分配）

```sql
CREATE TABLE IF NOT EXISTS memory_chunks (
  id            TEXT PRIMARY KEY,          -- 内容 hash，幂等键
  scope         TEXT NOT NULL,             -- 'session' | 'project' | 'global'
  scope_key     TEXT NOT NULL,             -- session_id / project_id / '*'
  session_id    TEXT,                      -- 来源会话（可空）
  run_id        TEXT,                      -- 来源 DAG run（可空）
  source        TEXT NOT NULL,             -- 'session' | 'experience' | 'manual'
  content       TEXT NOT NULL,             -- chunk 文本（已 redact）
  content_hash  TEXT NOT NULL UNIQUE,      -- 去重
  embedding     BLOB NOT NULL,             -- Float32Array 序列化
  dim           INTEGER NOT NULL,          -- 向量维度（校验用）
  metadata      TEXT,                      -- JSON: role, sequence, timestamp...
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_scope ON memory_chunks(scope, scope_key);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_session ON memory_chunks(session_id);
```

### 6.2 配置表 `memory_rag_config`（沿用现有 `*_config` 模式）

```sql
CREATE TABLE IF NOT EXISTS memory_rag_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),   -- 单行
  enabled          INTEGER NOT NULL DEFAULT 0,
  model_id         TEXT NOT NULL DEFAULT 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  dim              INTEGER NOT NULL DEFAULT 384,
  chunk_size       INTEGER NOT NULL DEFAULT 512,
  chunk_overlap    INTEGER NOT NULL DEFAULT 64,
  top_k            INTEGER NOT NULL DEFAULT 5,
  min_score        REAL    NOT NULL DEFAULT 0.35,
  max_chunks       INTEGER NOT NULL DEFAULT 50000,  -- 超出则触发 §10 演进
  inject_position  TEXT    NOT NULL DEFAULT 'system_prefix',
  updated_at       TEXT NOT NULL
);
```

> 迁移必须幂等：`CREATE TABLE IF NOT EXISTS` + `ON CONFLICT DO NOTHING` 种子行，
> 并在 `CLEARABLE_TABLES` 集合中加入 `memory_chunks`（保持 `_clearAllSessions` 语义一致）。

---

## 7. 接口设计

### 7.1 TypeScript API（`atms_manager/src/persistence/memory-rag.ts` 等）

```ts
interface EmbeddingService {
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;   // 批量
  warmup(): Promise<void>;                            // 预载模型
}

interface VectorIndex {
  add(id: string, vec: Float32Array): void;
  remove(id: string): void;
  search(query: Float32Array, opts: { topK: number; scope?: string; scopeKey?: string }):
    Array<{ id: string; score: number }>;
  size(): number;
}

interface Chunker {
  chunk(text: string): Array<{ content: string; meta: Record<string, unknown> }>;
}

interface MemoryRetriever {
  ingest(source: IngestSource): Promise<IngestReport>;
  retrieve(query: string, opts: RetrieveOpts): Promise<RecallResult>;
  stats(): Promise<MemoryStats>;
}
```

### 7.2 注入契约

Manager / Voice Agent 构造上下文时，在 `loadMessages` 之后调用：

```ts
const recall = await retriever.retrieve(currentQuery, { scope: sessionScope, topK: cfg.top_k });
if (recall.chunks.length) {
  systemPrompt += `\n<long_term_memory>\n` +
    recall.chunks.map(c => `[${c.score.toFixed(2)}] (来源:${c.source}:${c.scopeKey}) ${c.content}`).join("\n") +
    `\n</long_term_memory>`;
}
```

> 注入块**只增不改**近期线性上下文；召回为空时不注入、不留空标签。

### 7.3 CLI（`atms memory`）

```bash
atms memory warmup                 # 预载 embedding 模型
atms memory ingest --source session --session-id <id>
atms memory search "数据管道需求" --top-k 5 --scope project
atms memory stats                  # chunk 数、维度、scope 分布、最近写入
atms memory reindex                # 全量重建索引（换模型后必跑）
```

### 7.4 HTTP API（沿用 `/api/...` 风格，受 control-plane 认证约束）

```
GET  /api/memory/search?query=...&top_k=5&scope=project
POST /api/memory/ingest            { source, scope_key }
GET  /api/memory/stats
POST /api/memory/reindex
```

---

## 8. 评估（对应"evaluation of AI behavior"）

RAG 的价值要用数据证明，不是"能跑就行"。复用 Atms 现有 eval/scorecard 思路：

1. **检索质量**：构造一个标注集（~30 条 query + 应召回的 chunk），量测
   `Recall@5`、`MRR`。目标：相关片段在 top-5 命中率 ≥ 0.8。
2. **端到端**：同一组任务，开/关 RAG 各跑一遍，对比 Manager 回答是否更准确、
   是否更少"失忆"（重复问已说过的事）。
3. **延迟**：单条 embed 耗时、top-5 检索耗时（目标：检索 P95 < 100ms，模型 warm 后）。
4. **规模**：chunk 数 vs 检索耗时曲线，确认暴力 cosine 在 5 万内可接受。

> 评估报告落 `evals/rag/`，可被 `atms memory stats --eval` 引用，作为面试可展示的硬证据。

---

## 9. 安全与隐私

- **Redaction 先行**：任何内容进 `memory_chunks` 前，走现有共享 redactor
  （与 activity plane 同一信任边界），确保无 API key / token / 密码。
- **不存凭据**：`embedding` 与 `content` 均不得含密钥；`metadata` 走 size-bound。
- **Scope 隔离**：检索默认限定当前 session/project scope，`global` 需显式开启。
- **可删除**：`atms memory purge --scope ...` 支持按 scope 清理；
  `memory_chunks` 加入 `CLEARABLE_TABLES` 以纳入统一清理。
- **模型本地**：embedding 权重缓存在 `ATMS_HOME` 下，不上传任何内容到外部。

---

## 10. 演进路径（本期不做，明确留口）

| 阶段 | 触发条件 | 动作 |
| --- | --- | --- |
| 当前 | chunk < 5 万 | 暴力 cosine + 内存 BLOB |
| 下一步 | chunk > 5 万 或 检索 P95 超标 | `VectorIndex` 换 USearch/HNSWlib（WASM），SQLite 仍做持久层 |
| 再下一步 | 需要更强中文 / 多模态 | 切 `bge-m3`，或起 local TEI 服务（仍 local） |
| 可选 | 需要图语义 | 结合 `experience_relationships` 做 1-hop 图 RAG |

接口层（`VectorIndex` / `EmbeddingService`）已为这些演进预留抽象，换实现不改消费层。

---

## 11. 实现步骤（按依赖排序）

1. **选型基准**：拉取候选模型，跑 §4.1 的中英基准，定最终 `model_id`。
2. **迁移**：新 `schema_migrations` 版本，建 `memory_chunks` + `memory_rag_config`，
   加入 `CLEARABLE_TABLES`，写幂等测试。
3. **EmbeddingService**：`@xenova/transformers` 封装，批量 embed + warmup + 模型缓存，
   单测（固定文本 → 固定维度，相似度方向正确）。
4. **Chunker**：定长 + 重叠切分，单测（边界、空串、超长、中文按字符而非按 word）。
5. **VectorIndex（BruteForce）**：内存 BLOB + cosine，单测（top-k 排序、scope 过滤、增删）。
6. **MemoryRetriever**：ingest（redact→chunk→embed→落库→索引）+ retrieve，单测（幂等、去重、阈值）。
7. **注入接入**：Manager / Voice Agent 在 `loadMessages` 后注入 `<long_term_memory>`，
   集成测试（开/关 RAG 上下文差异）。
8. **CLI + HTTP**：`atms memory *` 与 `/api/memory/*`，受现有认证约束。
9. **评估**：建标注集，跑 §8 指标，出报告。
10. **文档**：更新 `README.md` 的 Feature List（加 "Long-Term RAG Memory"）+ 新增 `docs/rag-memory.md`。

> 每步先写 vitest（TDD），再实现，保证 376 个现有测试不被破坏。

---

## 12. 验收标准（Definition of Done）

- [ ] `memory_chunks` / `memory_rag_config` 迁移幂等，旧库可平滑升级。
- [ ] `EmbeddingService` 本地跑通，中英样本 embed 维度正确、相似文本 cosine 更高。
- [ ] `MemoryRetriever.retrieve` 在标注集上 Recall@5 ≥ 0.8。
- [ ] Manager / Voice Agent 开 RAG 后，长会话能召回早期相关信息（集成测试证明）。
- [ ] 入库内容 100% 过 redaction（测试注入含密钥样本，验证不入库）。
- [ ] `atms memory search/ingest/stats/reindex` 全部可用。
- [ ] 现有 376 测试全绿，新增测试覆盖 chunk/embed/检索/注入/redaction/迁移。
- [ ] `docs/rag-memory.md` + README 更新，含真实评估数据。

---

