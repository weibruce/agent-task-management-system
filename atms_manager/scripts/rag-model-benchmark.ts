/**
 * RAG model selection benchmark.
 *
 * Downloads candidate embedding models from HuggingFace, measures single-text
 * embed latency (cold + warm) on a mixed Chinese/English sample, and verifies
 * that semantically similar pairs score higher than unrelated pairs.
 *
 * Run: npm run benchmark:rag  (from atms_manager/)
 * Model cache: ATMS_HOME/rag-models (defaults to ~/.atms/rag-models)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline, env as transformersEnv } from "@xenova/transformers";

const SAMPLES: Array<{ id: string; text: string }> = [
  // Chinese — Atms-style content
  { id: "zh-pipeline", text: "用户上周提过的那个数据管道需求，需要每天凌晨两点跑一次 ETL，把订单数据同步到分析库" },
  { id: "zh-docker", text: "Docker 容器里 host.docker.internal 无法解析，宿主机上需要改用 127.0.0.1 访问本地 LLM 服务" },
  { id: "zh-dag", text: "DAG 执行引擎支持多 Agent 编排，每个节点独立上下文，plan 到 implement 到 test 到 review 共五个阶段" },
  { id: "zh-timeout", text: "本地 27B 模型处理大上下文时超过了默认的 300 秒超时，需要把 Manager Agent 的 turn timeout 调大到 30 分钟" },
  { id: "zh-coffee", text: "帮我写一个关于咖啡冲煮的静态网页，包含手冲、法压、意式三种方式的对比表格" },
  { id: "zh-auth", text: "GitHub 的 fine-grained token 缺少 contents:write 权限，git push 返回 403，需要重新生成带 Contents Read and Write 的 token" },
  // English
  { id: "en-pipeline", text: "The nightly ETL pipeline syncs order data from the production database into the analytics warehouse at 2 AM" },
  { id: "en-docker", text: "Docker containers need host-gateway mapping so the LLM base URL resolves back to the host machine" },
  { id: "en-dag", text: "The DAG runtime schedules agent nodes with explicit handoffs, keeping each node in an isolated context window" },
  { id: "en-timeout", text: "The local 27B model exceeds the 300 second turn timeout on large contexts, so the limit was raised to 30 minutes" },
  { id: "en-coffee", text: "Build a small static web page comparing pour-over, French press, and espresso coffee brewing methods" },
  { id: "en-auth", text: "The GitHub personal access token is missing the contents write permission, so git push fails with HTTP 403" },
  // Unrelated noise
  { id: "noise-weather", text: "The weather forecast for tomorrow shows light rain in the afternoon with a high of 21 degrees" },
  { id: "noise-math", text: "Prove that the sum of the first n odd numbers equals n squared by mathematical induction" },
  { id: "noise-food", text: "A good omelette requires beating the eggs with a pinch of salt and folding in the cheese at the end" },
];

/** (query, relevant_ids, irrelevant_id) — relevant must beat irrelevant. */
const PAIRS: Array<{ query: string; relevant: string; irrelevant: string; note: string }> = [
  { query: "数据管道 ETL 同步", relevant: "zh-pipeline", irrelevant: "noise-weather", note: "zh pipeline query" },
  { query: "数据管道 ETL", relevant: "en-pipeline", irrelevant: "noise-math", note: "zh query -> en pipeline doc" },
  { query: "Docker 容器访问宿主机 LLM", relevant: "zh-docker", irrelevant: "noise-food", note: "zh docker" },
  { query: "容器内 host.docker.internal 解析", relevant: "en-docker", irrelevant: "noise-weather", note: "zh query -> en docker" },
  { query: "DAG 节点编排 上下文隔离", relevant: "zh-dag", irrelevant: "noise-math", note: "zh dag" },
  { query: "DAG handoff scheduling", relevant: "en-dag", irrelevant: "noise-food", note: "en dag" },
  { query: "本地模型超时 300 秒", relevant: "zh-timeout", irrelevant: "noise-weather", note: "zh timeout" },
  { query: "local model turn timeout", relevant: "en-timeout", irrelevant: "noise-math", note: "en timeout" },
  { query: "咖啡冲煮网页", relevant: "zh-coffee", irrelevant: "noise-math", note: "zh coffee" },
  { query: "coffee brewing web page", relevant: "en-coffee", irrelevant: "noise-weather", note: "en coffee" },
  { query: "GitHub token 权限 403", relevant: "zh-auth", irrelevant: "noise-food", note: "zh auth" },
  { query: "github token contents write 403", relevant: "en-auth", irrelevant: "noise-math", note: "en auth" },
];

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function benchModel(modelId: string, cacheDir: string): Promise<void> {
  console.log(`\n=== ${modelId} ===`);
  const t0 = Date.now();
  const embedder = await pipeline("feature-extraction", modelId, {
    quantized: true,
  });
  console.log(`model load (cold, download if needed): ${Date.now() - t0} ms`);

  const dim = (await embedder(SAMPLES[0].text, { pooling: "mean", normalize: true })).data.length;
  console.log(`dim: ${dim}`);

  // Warm timing: embed all samples, measure per-text ms (median)
  const vectors = new Map<string, Float32Array>();
  const timings: number[] = [];
  for (const s of SAMPLES) {
    const t = Date.now();
    const out = await embedder(s.text, { pooling: "mean", normalize: true });
    timings.push(Date.now() - t);
    vectors.set(s.id, out.data as Float32Array);
  }
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)];
  console.log(`warm embed latency: median ${median} ms, p95 ${timings[Math.floor(timings.length * 0.95)]} ms (${SAMPLES.length} texts)`);

  // Semantic direction checks
  let passes = 0;
  for (const p of PAIRS) {
    const q = (await embedder(p.query, { pooling: "mean", normalize: true })).data as Float32Array;
    const rel = cosine(q, vectors.get(p.relevant)!);
    const irr = cosine(q, vectors.get(p.irrelevant)!);
    const ok = rel > irr;
    if (ok) passes += 1;
    console.log(`  ${ok ? "PASS" : "FAIL"} ${p.note}: relevant=${rel.toFixed(3)} irrelevant=${irr.toFixed(3)}`);
  }
  console.log(`direction check: ${passes}/${PAIRS.length} passed`);
}

async function main(): Promise<void> {
  const cacheDir = process.env.RAG_MODEL_CACHE
    ?? path.join(process.env.ATMS_HOME ?? path.join(os.homedir(), ".atms"), "rag-models");
  fs.mkdirSync(cacheDir, { recursive: true });
  transformersEnv.cacheDir = cacheDir;
  console.log(`model cache dir: ${cacheDir}`);

  const models = [
    "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    "Xenova/all-MiniLM-L6-v2",
  ];
  for (const modelId of models) {
    try {
      await benchModel(modelId, cacheDir);
    } catch (err) {
      console.error(`FAILED ${modelId}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
