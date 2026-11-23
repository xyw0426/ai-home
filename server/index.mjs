// AI Home 轻量服务：代理 OpenAI 兼容的大模型 API，并在生产模式下托管前端。
// 配置来自环境变量 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL；界面里也可以临时覆盖（只保存在进程内存中）。
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDialogueMessages, buildParseMessages, cleanLine, extractJson } from './prompts.mjs';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

const envConfig = {
  apiKey: process.env.LLM_API_KEY || '',
  baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
  model: process.env.LLM_MODEL || 'deepseek-chat',
};
/** 界面里填写的覆盖项（仅内存） */
let override = { apiKey: '', baseUrl: '', model: '', forceDemo: false };
const stats = { calls: 0, failures: 0, lastError: '', lastLatencyMs: 0 };

function current() {
  const apiKey = override.apiKey || envConfig.apiKey;
  const baseUrl = override.baseUrl || envConfig.baseUrl;
  const model = override.model || envConfig.model;
  const source = override.apiKey ? 'ui' : envConfig.apiKey ? 'env' : 'none';
  const mode = apiKey && !override.forceDemo ? 'live' : 'demo';
  return { apiKey, baseUrl, model, source, mode };
}

function publicConfig() {
  const c = current();
  return {
    mode: c.mode,
    baseUrl: c.baseUrl,
    model: c.model,
    hasKey: !!c.apiKey,
    keyHint: c.apiKey ? `${c.apiKey.slice(0, 3)}…${c.apiKey.slice(-4)}` : '',
    source: c.source,
    forceDemo: override.forceDemo,
    env: { hasKey: !!envConfig.apiKey, baseUrl: envConfig.baseUrl, model: envConfig.model },
    stats,
  };
}

function chatUrl(baseUrl) {
  const b = baseUrl.replace(/\/+$/, '');
  return /\/chat\/completions$/.test(b) ? b : `${b}/chat/completions`;
}

async function chat(messages, { json = false, maxTokens = 120, temperature = 0.8, cfg = current() } = {}) {
  if (!cfg.apiKey) throw new Error('未配置 API 密钥');
  const started = Date.now();
  stats.calls++;
  const body = { model: cfg.model, messages, temperature, max_tokens: maxTokens, stream: false };
  if (json) body.response_format = { type: 'json_object' };
  try {
    const res = await fetch(chatUrl(cfg.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`模型服务返回 ${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content ?? '';
    stats.lastLatencyMs = Date.now() - started;
    return content;
  } catch (e) {
    stats.failures++;
    stats.lastError = String(e?.message || e).slice(0, 300);
    throw e;
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 200_000) throw new Error('请求体过大');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, p);
  if (!file.startsWith(DIST)) return send(res, 403, { error: 'forbidden' });
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(DIST, 'index.html');
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端尚未构建：请先运行 npm run build，或使用 npm run dev。');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/health') return send(res, 200, { ok: true });
    if (url.pathname === '/api/config' && req.method === 'GET') return send(res, 200, publicConfig());
    if (url.pathname === '/api/config' && req.method === 'POST') {
      const b = await readBody(req);
      if (b.reset) override = { apiKey: '', baseUrl: '', model: '', forceDemo: false };
      if (typeof b.apiKey === 'string' && b.apiKey.trim()) override.apiKey = b.apiKey.trim();
      if (b.clearKey) override.apiKey = '';
      if (typeof b.baseUrl === 'string') override.baseUrl = b.baseUrl.trim();
      if (typeof b.model === 'string') override.model = b.model.trim();
      if (typeof b.forceDemo === 'boolean') override.forceDemo = b.forceDemo;
      return send(res, 200, publicConfig());
    }
    if (url.pathname === '/api/config/test' && req.method === 'POST') {
      const b = await readBody(req);
      const base = current();
      const cfg = {
        ...base,
        apiKey: (b.apiKey && String(b.apiKey).trim()) || base.apiKey,
        baseUrl: (b.baseUrl && String(b.baseUrl).trim()) || base.baseUrl,
        model: (b.model && String(b.model).trim()) || base.model,
      };
      const t0 = Date.now();
      try {
        const out = await chat([{ role: 'user', content: '用一句不超过10个字的中文问好。' }], { maxTokens: 30, cfg });
        return send(res, 200, { ok: true, latencyMs: Date.now() - t0, sample: cleanLine(out) });
      } catch (e) {
        return send(res, 200, { ok: false, error: String(e?.message || e).slice(0, 300) });
      }
    }
    if (url.pathname === '/api/dialogue' && req.method === 'POST') {
      if (current().mode !== 'live') return send(res, 409, { error: 'demo' });
      const ctx = await readBody(req);
      const out = await chat(buildDialogueMessages(ctx), { maxTokens: 90, temperature: 0.9 });
      const text = cleanLine(out, ctx?.speaker?.name);
      if (!text) return send(res, 502, { error: '模型返回为空' });
      return send(res, 200, { text });
    }
    if (url.pathname === '/api/parse' && req.method === 'POST') {
      if (current().mode !== 'live') return send(res, 409, { error: 'demo' });
      const ctx = await readBody(req);
      const out = await chat(buildParseMessages(ctx), { json: true, maxTokens: 220, temperature: 0.1 });
      const result = extractJson(out);
      if (!result || !['task', 'clarify', 'chat'].includes(result.kind)) return send(res, 502, { error: '无法解析模型输出', raw: out.slice(0, 300) });
      return send(res, 200, { result });
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    return serveStatic(req, res);
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e).slice(0, 300) });
  }
});

server.listen(PORT, HOST, () => {
  const c = current();
  console.log(`[AI Home] 服务已启动 http://${HOST}:${PORT}  模式：${c.mode === 'live' ? `真实模型 ${c.model} @ ${c.baseUrl}` : '演示模式（未配置 LLM_API_KEY）'}`);
});
