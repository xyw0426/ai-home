import { useState } from 'react';
import type { ServerConfig } from '../sim/remote';

interface Props {
  config: ServerConfig | null;
  serverDown: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

export function ApiModal({ config, serverDown, onClose, onChanged }: Props) {
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? 'https://api.deepseek.com');
  const [model, setModel] = useState(config?.model ?? 'deepseek-chat');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  const test = () =>
    run(async () => {
      const r = await post('/api/config/test', { baseUrl, model, apiKey });
      setMsg(r.ok ? { ok: true, text: `连接成功（${r.latencyMs} ms），模型回复：「${r.sample}」` } : { ok: false, text: `连接失败：${r.error}` });
    });

  const save = () =>
    run(async () => {
      await post('/api/config', { baseUrl, model, apiKey: apiKey || undefined, forceDemo: false });
      setApiKey('');
      await onChanged();
      setMsg({ ok: true, text: '已保存。新的对话和指令解析会使用这个配置。' });
    });

  const reset = () =>
    run(async () => {
      const r = await post('/api/config', { reset: true });
      setBaseUrl(r.baseUrl);
      setModel(r.model);
      await onChanged();
      setMsg({ ok: true, text: r.hasKey ? '已恢复为服务端环境变量配置。' : '已清除界面填写的密钥；环境变量里没有密钥，当前为演示模式。' });
    });

  const toggleDemo = (v: boolean) =>
    run(async () => {
      await post('/api/config', { forceDemo: v });
      await onChanged();
    });

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="模型 API 设置">
        <div className="modal-head">
          <h2>模型 API 设置</h2>
          <button className="x" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {serverDown ? (
          <p className="warn">没有连接到本地 Node 服务（/api）。请用 <code>npm run dev</code> 或 <code>npm start</code> 启动；在此之前界面使用演示模式。</p>
        ) : (
          <div className="status-grid">
            <span>当前模式</span>
            <b className={config?.mode === 'live' ? 'ok' : 'amber'}>{config?.mode === 'live' ? '真实模型' : '演示模式（预置对白 + 规则解析）'}</b>
            <span>密钥来源</span>
            <b>{config?.source === 'ui' ? `界面填写（${config.keyHint}）` : config?.source === 'env' ? `环境变量 LLM_API_KEY（${config.keyHint}）` : '未配置'}</b>
            <span>调用统计</span>
            <b>
              {config?.stats.calls ?? 0} 次，失败 {config?.stats.failures ?? 0} 次{config?.stats.lastLatencyMs ? `，最近耗时 ${config.stats.lastLatencyMs} ms` : ''}
            </b>
            {config?.stats.lastError && (
              <>
                <span>最近错误</span>
                <b className="err">{config.stats.lastError}</b>
              </>
            )}
          </div>
        )}
        <label className="field">
          <span>服务地址（OpenAI 兼容）</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com" />
        </label>
        <label className="field">
          <span>模型名称</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
        </label>
        <label className="field">
          <span>API 密钥</span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.hasKey ? '留空则保留当前密钥' : 'sk-...'}
          />
        </label>
        <p className="note">
          密钥只发送给本机的 Node 服务并保存在进程内存中，不会写入文件，也不会再返回给浏览器；服务重启后恢复为环境变量（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL）的配置。
        </p>
        {msg && <p className={msg.ok ? 'okmsg' : 'errmsg'}>{msg.text}</p>}
        <div className="modal-actions">
          <label className="toggle">
            <input type="checkbox" checked={!!config?.forceDemo} disabled={busy || serverDown} onChange={(e) => toggleDemo(e.target.checked)} />
            <span>强制使用演示模式</span>
          </label>
          <span className="spacer" />
          <button className="btn" onClick={reset} disabled={busy || serverDown}>
            恢复环境变量配置
          </button>
          <button className="btn" onClick={test} disabled={busy || serverDown}>
            测试连接
          </button>
          <button className="btn primary" onClick={save} disabled={busy || serverDown}>
            保存并启用
          </button>
        </div>
      </div>
    </div>
  );
}
