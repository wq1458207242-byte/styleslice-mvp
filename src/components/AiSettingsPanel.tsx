import { LoaderCircle, PlugZap, X } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { PROVIDER_PRESETS, testAiCapabilities } from '../lib/modelscopeClient';
import type { AiTestResult, ModelScopeSettings } from '../types/workflow';

interface AiSettingsPanelProps {
  open: boolean;
  settings: ModelScopeSettings;
  onChange: (settings: ModelScopeSettings) => void;
  onClose: () => void;
}

const providerLabels: Record<ModelScopeSettings['provider'], string> = {
  modelscope: 'ModelScope 魔搭',
  siliconflow: 'SiliconFlow 硅基流动',
};

const siliconFlowModelHints = {
  chat: '例如：Qwen/Qwen2.5-72B-Instruct、deepseek-ai/DeepSeek-V3；以硅基流动控制台模型 ID 为准',
  vision: '例如：Qwen/Qwen2.5-VL-72B-Instruct；必须是支持图片输入的 VL 模型',
  image: '例如：Tongyi-MAI/Z-Image-Turbo、Tongyi-MAI/Z-Image；以硅基流动图片生成模型列表为准',
};

const modelscopeHints = {
  chat: '填写支持 /chat/completions 的文本模型 ID',
  vision: '填写支持多模态图片输入的模型 ID；不要使用纯文本模型做视觉分析',
  image: '填写支持 /images/generations 的文生图模型 ID',
};

function statusLabel(status: AiTestResult['status']) {
  return {
    idle: '待测试',
    running: '测试中',
    success: '通过',
    warning: '跳过/警告',
    error: '失败',
  }[status];
}

export function AiSettingsPanel({ open, settings, onChange, onClose }: AiSettingsPanelProps) {
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string>();
  const [testOk, setTestOk] = useState<boolean>();
  const [testResults, setTestResults] = useState<AiTestResult[]>([]);

  if (!open) return null;

  const hints = settings.provider === 'siliconflow' ? siliconFlowModelHints : modelscopeHints;

  const clearTest = () => {
    setTestMessage(undefined);
    setTestOk(undefined);
    setTestResults([]);
  };

  const update = (field: keyof ModelScopeSettings) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = field === 'timeoutMs' ? Number(event.target.value) : event.target.value;
    if (field === 'apiKey') {
      onChange({
        ...settings,
        apiKey: String(value),
        providerKeys: {
          ...(settings.providerKeys ?? {}),
          [settings.provider ?? 'modelscope']: String(value),
        },
      });
    } else {
      onChange({ ...settings, [field]: value });
    }
    clearTest();
  };

  const switchProvider = (provider: ModelScopeSettings['provider']) => {
    const nextKey = settings.providerKeys?.[provider] ?? '';
    onChange({
      ...settings,
      ...PROVIDER_PRESETS[provider],
      provider,
      apiKey: nextKey,
      providerKeys: {
        ...(settings.providerKeys ?? {}),
        [settings.provider]: settings.apiKey,
      },
    } as ModelScopeSettings);
    clearTest();
  };

  const runConnectionTest = async () => {
    setTesting(true);
    setTestMessage('正在进行 AI 能力体检：本地代理 / 文字 / 视觉 / 生图');
    setTestOk(undefined);
    setTestResults([
      { id: 'proxy', label: '本地代理', status: 'running', message: '检查 npm run api 是否运行' },
      { id: 'text', label: '文字模型', status: 'running', message: '等待测试' },
      { id: 'vision', label: '视觉模型', status: 'running', message: '等待测试' },
      { id: 'image', label: '生图模型', status: 'running', message: '等待测试' },
    ]);
    try {
      const results = await testAiCapabilities(settings);
      setTestResults(results);
      const hasError = results.some((item) => item.status === 'error');
      const hasWarning = results.some((item) => item.status === 'warning');
      setTestOk(!hasError);
      setTestMessage(hasError ? '部分能力不可用，请查看下方分项诊断。' : hasWarning ? '基础连接可用，但有能力未配置或被跳过。' : '全部能力测试通过。');
    } catch (error) {
      setTestOk(false);
      setTestMessage(error instanceof Error ? error.message : '连接测试失败');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">AI PROVIDER</span>
            <h2 id="ai-settings-title">AI 推理设置</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭 AI 设置"><X size={15} /></button>
        </div>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => onChange({ ...settings, enabled: event.target.checked })}
          />
          <span>启用 AI 推理</span>
        </label>

        <div className="settings-grid">
          <label className="field">
            <span>调用平台</span>
            <select value={settings.provider ?? 'modelscope'} onChange={(event) => switchProvider(event.target.value as ModelScopeSettings['provider'])}>
              <option value="modelscope">{providerLabels.modelscope}</option>
              <option value="siliconflow">{providerLabels.siliconflow}</option>
            </select>
          </label>
          <label className="field">
            <span>Base URL</span>
            <input value={settings.baseUrl} onChange={update('baseUrl')} placeholder="https://api.siliconflow.cn/v1" />
          </label>
          <label className="field">
            <span>API Key</span>
            <input type="password" value={settings.apiKey} onChange={update('apiKey')} placeholder={`填写 ${providerLabels[settings.provider ?? 'modelscope']} API Key`} />
          </label>
          <label className="field">
            <span>文字模型</span>
            <input value={settings.chatModel} onChange={update('chatModel')} placeholder={hints.chat} />
          </label>
          <label className="field">
            <span>图片理解模型</span>
            <input value={settings.visionModel} onChange={update('visionModel')} placeholder={hints.vision} />
          </label>
          <label className="field">
            <span>生图模型</span>
            <input value={settings.imageModel} onChange={update('imageModel')} placeholder={hints.image} />
          </label>
          <label className="field">
            <span>生图协议</span>
            <select value={settings.imageProtocol} onChange={update('imageProtocol')}>
              <option value="modelscope-proxy">ModelScope 后端代理</option>
              <option value="siliconflow">SiliconFlow 后端代理</option>
              <option value="modelscope-async">ModelScope 前端异步</option>
              <option value="openai">OpenAI 同步/兼容</option>
              <option value="dashscope-async">DashScope 后端代理</option>
            </select>
          </label>
          <label className="field">
            <span>文字/视觉路径</span>
            <input value={settings.chatPath} onChange={update('chatPath')} placeholder="/chat/completions" />
          </label>
          <label className="field">
            <span>生图路径</span>
            <input value={settings.imagePath} onChange={update('imagePath')} placeholder="/images/generations" />
          </label>
          <label className="field">
            <span>本地代理</span>
            <input value={settings.backendUrl} onChange={update('backendUrl')} placeholder="http://127.0.0.1:8787" />
          </label>
          <label className="field">
            <span>异步任务查询路径</span>
            <textarea value={settings.taskPath} onChange={update('taskPath')} rows={3} placeholder="/tasks/{task_id}" />
          </label>
          <label className="field">
            <span>超时毫秒</span>
            <input type="number" min={10_000} step={5_000} value={settings.timeoutMs} onChange={update('timeoutMs')} />
          </label>
        </div>

        <div className="settings-test-row">
          <button className="secondary-button" onClick={runConnectionTest} disabled={testing}>
            {testing ? <LoaderCircle className="spin" size={15} /> : <PlugZap size={15} />}
            分项测试
          </button>
          {testMessage && <span className={`settings-test-message ${testOk ? 'success' : testOk === false ? 'error' : ''}`}>{testMessage}</span>}
        </div>

        {testResults.length > 0 && (
          <div className="ai-test-grid">
            {testResults.map((result) => (
              <article className={`ai-test-card ${result.status}`} key={result.id}>
                <strong>{result.label}</strong>
                <span>{statusLabel(result.status)}{result.durationMs ? ` · ${result.durationMs} ms` : ''}</span>
                <p>{result.message}</p>
              </article>
            ))}
          </div>
        )}

        <p className="settings-note">
          建议真实生产时始终运行 <code>npm run api</code>。文字/视觉/生图是三种不同能力：文字模型连通不代表视觉模型能看图，也不代表生图模型可用。切换平台时请同时切换对应平台支持的模型 ID。
        </p>
      </section>
    </div>
  );
}
