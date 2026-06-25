import type { AiTestResult, AssetClassification, AssetImage, GenerationQualityReport, ModelScopeSettings, StylePack } from '../types/workflow';

const defaultTaskPaths = [
  '/images/generations/{task_id}',
  '/images/generations/{task_id}/result',
  '/images/generations?task_id={task_id}',
  '/tasks/{task_id}',
  '/tasks/{task_id}/result',
  'https://api-inference.modelscope.cn/api/v1/images/generations/{task_id}',
  'https://api-inference.modelscope.cn/api/v1/images/generations/{task_id}/result',
  'https://api-inference.modelscope.cn/api/v1/tasks/{task_id}',
  'https://api-inference.modelscope.cn/api/v1/tasks/{task_id}/result',
].join('\n');

export const DEFAULT_MODELSCOPE_SETTINGS: ModelScopeSettings = {
  enabled: false,
  provider: 'modelscope',
  apiKey: '',
  providerKeys: {},
  baseUrl: 'https://api-inference.modelscope.cn/v1',
  chatModel: '',
  visionModel: '',
  imageModel: '',
  chatPath: '/chat/completions',
  imagePath: '/images/generations',
  taskPath: defaultTaskPaths,
  imageProtocol: 'modelscope-proxy',
  backendUrl: 'http://127.0.0.1:8787',
  timeoutMs: 300_000,
};

export const PROVIDER_PRESETS: Record<ModelScopeSettings['provider'], Partial<ModelScopeSettings>> = {
  modelscope: {
    provider: 'modelscope',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    chatPath: '/chat/completions',
    imagePath: '/images/generations',
    imageProtocol: 'modelscope-proxy',
    timeoutMs: 300_000,
  },
  siliconflow: {
    provider: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    chatPath: '/chat/completions',
    imagePath: '/images/generations',
    imageProtocol: 'siliconflow',
    timeoutMs: 120_000,
  },
};

export function isModelScopeReady(settings: ModelScopeSettings) {
  return Boolean(settings.enabled && settings.apiKey.trim() && settings.baseUrl.trim());
}

function providerName(settings: ModelScopeSettings) {
  return settings.provider === 'siliconflow' ? 'SiliconFlow' : 'ModelScope';
}

function endpoint(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => window.clearTimeout(timer) };
}

function parseResponseBody(text: string) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 1200) };
  }
}

function errorMessage(data: any) {
  const errors = data?.errors ?? data?.error ?? data?.output?.errors;
  if (Array.isArray(errors)) return errors.map((item) => item?.message ?? item?.code ?? JSON.stringify(item)).join('；');
  if (errors && typeof errors === 'object') return errors.message ?? JSON.stringify(errors);
  if (typeof errors === 'string') return errors;
  return data?.message ?? data?.output?.message ?? data?.task_message;
}

async function postJson(settings: ModelScopeSettings, path: string, body: unknown) {
  const timeout = withTimeout(settings.timeoutMs);
  try {
    const response = await fetch(endpoint(settings.baseUrl, path), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    const text = await response.text();
    const data = parseResponseBody(text);
    if (!response.ok) throw new Error(`${providerName(settings)} ${response.status}: ${errorMessage(data) ?? response.statusText}`);
    return data;
  } finally {
    timeout.clear();
  }
}

function extractText(data: any): string {
  const content = data?.choices?.[0]?.message?.content
    ?? data?.output?.text
    ?? data?.text
    ?? data?.message
    ?? data?.output?.message
    ?? '';
  if (Array.isArray(content)) return content.map((part) => part?.text ?? '').join('\n').trim();
  return String(content).trim();
}

function safeJson<T>(text: string, fallback: T): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取参考图'));
    image.src = dataUrl;
  });
}

async function compressReferenceImage(asset: AssetImage, maxSize = 768): Promise<AssetImage> {
  const image = await loadImage(asset.dataUrl);
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return asset;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    ...asset,
    dataUrl: canvas.toDataURL('image/jpeg', 0.84),
    width: canvas.width,
    height: canvas.height,
  };
}

async function prepareReferenceImages(images: AssetImage[]) {
  return Promise.all(images.slice(0, 5).map((image) => compressReferenceImage(image)));
}

function openAiImageContent(images: AssetImage[]) {
  return images.map((image) => ({
    type: 'image_url',
    image_url: { url: image.dataUrl },
  }));
}

function directImageContent(images: AssetImage[]) {
  return images.map((image) => ({
    type: 'image',
    image: image.dataUrl,
  }));
}

function looksLikeBase64Image(value: string) {
  return value.length > 800 && /^[A-Za-z0-9+/=\s]+$/.test(value);
}

function extractImageCandidate(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('data:image/')) return trimmed;
    if (/^https?:\/\/\S+/i.test(trimmed)) return trimmed.replace(/[)"'\]]+$/, '');
    const embeddedUrl = trimmed.match(/https?:\/\/[^\s"'<>),]+/i);
    if (embeddedUrl) return embeddedUrl[0];
    if (looksLikeBase64Image(trimmed)) return trimmed;
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractImageCandidate(item);
      if (candidate) return candidate;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['url', 'image_url', 'imageUrl', 'b64_json', 'base64', 'base64_image', 'image_base64', 'image', 'generated_image', 'oss_url', 'result_url', 'content', 'text']) {
      const candidate = extractImageCandidate(object[key]);
      if (candidate) return candidate;
    }
    for (const nested of Object.values(object)) {
      const candidate = extractImageCandidate(nested);
      if (candidate) return candidate;
    }
  }
  return undefined;
}

function extractImageUrl(data: any): string | undefined {
  return extractImageCandidate(data);
}

function normalizeImageOutput(output: string) {
  if (output.startsWith('data:')) return output;
  if (output.startsWith('http')) return output;
  return `data:image/png;base64,${output}`;
}

function summarizeValue(value: unknown, depth = 0): string {
  if (depth > 2) return '…';
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return `data:image/*;base64(${value.length} chars)`;
    if (value.length > 220) return `${value.slice(0, 220)}…`;
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value);
  if (Array.isArray(value)) return `[${value.slice(0, 3).map((item) => summarizeValue(item, depth + 1)).join(', ')}${value.length > 3 ? ', …' : ''}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).slice(0, 10).map(([key, item]) => `${key}: ${summarizeValue(item, depth + 1)}`).join(', ')}}`;
  }
  return typeof value;
}

function normalizePalette(palette: string[]) {
  return palette.filter(Boolean).slice(0, 5).join(', ');
}

function promptTooGeneric(prompt?: string) {
  if (!prompt) return true;
  const cleaned = prompt.trim();
  const usefulWords = cleaned.split(/\s+/).filter((word) => word.length > 3).length;
  return usefulWords < 18 || !/style|material|ornament|border|palette|cartoon|metal|paper|gem|glass|wood|stone|ui/i.test(cleaned);
}

function strengthenPrompt(parsed: Partial<StylePack>, promptText: string, fallbackPalette: string[]) {
  const contentGuard = 'reference images are style references only, do not copy their characters, mascots, screenshots, layouts, text, or scene content';
  const uiGuard = 'UI-only asset kit: reusable controls and containers, empty buttons, panels, badges, progress bars, dialog frames, avatar frames, tabs, icons as small accents only';
  if (!promptTooGeneric(parsed.prompt)) {
    return [
      parsed.prompt!,
      contentGuard,
      uiGuard,
      'production game UI sprite sheet, isolated assets, transparent background, clean margins, consistent scale, no readable text',
    ].join(', ');
  }
  const theme = promptText?.trim() || parsed.description || 'stylized game UI kit';
  const palette = normalizePalette(parsed.palette?.length ? parsed.palette : fallbackPalette);
  return [
    `${theme}, game UI sprite sheet art direction, ${contentGuard}`,
    `visual style: ${parsed.description || 'cohesive stylized game interface assets based on verified visual evidence from the reference images'}`,
    `materials: ${parsed.material || 'soft plastic, glossy jelly, matte clay, subtle bevel, soft highlights'}`,
    `shape language: ${parsed.shape || 'clear silhouette, readable thick border, balanced rounded corners, sliced-friendly panels'}`,
    `ornament rules: ${parsed.decoration || 'controlled corner ornaments, small icon accents, no clutter'}`,
    `color palette: ${palette || 'pastel base, bright accent, soft highlight'}`,
    uiGuard,
    'asset requirements: isolated UI assets, transparent background, clean padding, consistent lighting, consistent perspective, high quality game art, no readable text',
  ].join(', ');
}

function strengthenNegativePrompt(negativePrompt?: string) {
  const required = [
    'low quality',
    'blurry',
    'watermark',
    'signature',
    'readable text',
    'illegible letters',
    'numbers',
    'labels',
    'merged objects',
    'overlapping objects',
    'cropped asset',
    'busy background',
    'full-screen UI screenshot',
    'app screen mockup',
    'random sticker pack',
    'mascot character',
    'animal head',
    'toy figure',
    'doll',
    'face',
    'portrait',
    'photorealistic people',
    'inconsistent perspective',
    'inconsistent scale',
    'noisy texture',
  ].join(', ');
  const base = negativePrompt?.trim() || '';
  return base ? `${base}, ${required}` : required;
}

const COMPONENT_TYPE_DESCRIPTIONS: Record<string, string> = {
  按钮: 'empty rounded action button, no text, clear pressable bevel',
  面板: 'empty reusable content panel, sliced-friendly frame, no content inside',
  徽章: 'small UI badge or medal frame, abstract icon accent only, no animal face',
  进度条: 'progress bar frame with fill track, no text or numbers',
  对话框: 'empty dialog box frame, title area optional but no letters',
  头像框: 'empty avatar frame, no portrait, no face, no character inside',
  任务卡片: 'empty quest card container, no readable text',
  资源图标: 'simple resource icon in the same UI material, no mascot',
};

function describeComponentTypes(componentTypes: string[]) {
  return componentTypes
    .map((type) => COMPONENT_TYPE_DESCRIPTIONS[type] ? `${type} (${COMPONENT_TYPE_DESCRIPTIONS[type]})` : `${type} (reusable game UI component, no text)`)
    .join('; ');
}

async function fetchLocalProxy(settings: ModelScopeSettings, path: string, init: RequestInit) {
  const base = settings.backendUrl.replace(/\/$/, '');
  try {
    return await fetch(`${base}${path}`, init);
  } catch (error) {
    throw new Error(`无法连接本地 AI 代理 ${settings.backendUrl}。请在项目目录另开终端运行 npm run api。原始错误：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function proxyChatCompletion(settings: ModelScopeSettings, body: unknown) {
  const response = await fetchLocalProxy(settings, '/api/provider/chat-completion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerName: providerName(settings),
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      chatPath: settings.chatPath,
      ...body as Record<string, unknown>,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error || `本地 AI 代理 ${response.status}`);
  return data;
}

function makeTestResult(id: AiTestResult['id'], label: string, status: AiTestResult['status'], message: string, startedAt?: number): AiTestResult {
  return { id, label, status, message, durationMs: startedAt ? Math.round(performance.now() - startedAt) : undefined };
}

async function testLocalProxy(settings: ModelScopeSettings): Promise<AiTestResult> {
  const startedAt = performance.now();
  try {
    const response = await fetchLocalProxy(settings, '/health', { method: 'GET' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok !== true) throw new Error(data?.message || `HTTP ${response.status}`);
    return makeTestResult('proxy', '本地代理', 'success', 'npm run api 已连接', startedAt);
  } catch (error) {
    return makeTestResult('proxy', '本地代理', 'error', error instanceof Error ? error.message : String(error), startedAt);
  }
}

async function testTextModel(settings: ModelScopeSettings): Promise<AiTestResult> {
  const startedAt = performance.now();
  if (!settings.chatModel.trim()) return makeTestResult('text', '文字模型', 'warning', '未填写文字模型，跳过测试');
  try {
    const data = await proxyChatCompletion(settings, {
      model: settings.chatModel,
      messages: [
        { role: 'system', content: 'You are a connectivity test assistant.' },
        { role: 'user', content: 'Reply with only ok.' },
      ],
      temperature: 0,
      max_tokens: 8,
    });
    return makeTestResult('text', '文字模型', 'success', String(data?.text || 'ok'), startedAt);
  } catch (error) {
    return makeTestResult('text', '文字模型', 'error', error instanceof Error ? error.message : String(error), startedAt);
  }
}

function tinyVisionProbeImage() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('浏览器不支持 Canvas，无法生成视觉测试图');
  }
  context.fillStyle = '#ff99c8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(28, 32, 16, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#7bdff2';
  context.roundRect(52, 18, 30, 28, 8);
  context.fill();
  return canvas.toDataURL('image/png');
}

async function testVisionModel(settings: ModelScopeSettings): Promise<AiTestResult> {
  const startedAt = performance.now();
  if (!settings.visionModel.trim()) return makeTestResult('vision', '视觉模型', 'warning', '未填写视觉模型，跳过测试');
  try {
    const probe: AssetImage = { id: 'vision-probe', name: 'vision-probe.svg', dataUrl: tinyVisionProbeImage(), width: 96, height: 64 };
    const data = await proxyChatCompletion(settings, {
      model: settings.visionModel,
      messages: [
        { role: 'system', content: 'You are a vision connectivity test. Reply in JSON only.' },
        { role: 'user', content: [{ type: 'text', text: 'What are the colors and simple shapes in this image? Return {"seen":true,"colors":[],"shapes":[]}' }, ...openAiImageContent([probe])] },
      ],
      temperature: 0,
      max_tokens: 160,
    });
    const text = String(data?.text || extractText(data?.raw) || '');
    if (!/pink|white|blue|circle|rectangle|rect|ff99c8|7bdff2|seen/i.test(text)) {
      return makeTestResult('vision', '视觉模型', 'warning', `模型有返回，但没有明确描述测试图：${text.slice(0, 220)}`, startedAt);
    }
    return makeTestResult('vision', '视觉模型', 'success', `已识别测试图：${text.slice(0, 220)}`, startedAt);
  } catch (error) {
    return makeTestResult('vision', '视觉模型', 'error', error instanceof Error ? error.message : String(error), startedAt);
  }
}

async function testImageModel(settings: ModelScopeSettings): Promise<AiTestResult> {
  const startedAt = performance.now();
  if (!settings.imageModel.trim()) return makeTestResult('image', '生图模型', 'warning', '未填写生图模型，跳过测试');
  try {
    const image = await generateImageViaBackend(settings, 'simple clean game UI button, pink and cyan pastel style, isolated asset, no text, transparent or plain background', 'text, watermark, character, mascot, photo, low quality', 'ai-test-image.png');
    return makeTestResult('image', '生图模型', image.dataUrl ? 'success' : 'warning', image.dataUrl ? '已成功生成并转存测试图片' : '接口返回成功但未得到图片', startedAt);
  } catch (error) {
    return makeTestResult('image', '生图模型', 'error', error instanceof Error ? error.message : String(error), startedAt);
  }
}

export async function testAiCapabilities(settings: ModelScopeSettings): Promise<AiTestResult[]> {
  if (!settings.enabled) {
    return [
      makeTestResult('proxy', '本地代理', 'warning', 'AI 未启用'),
      makeTestResult('text', '文字模型', 'warning', 'AI 未启用'),
      makeTestResult('vision', '视觉模型', 'warning', 'AI 未启用'),
      makeTestResult('image', '生图模型', 'warning', 'AI 未启用'),
    ];
  }
  if (!settings.apiKey.trim()) {
    return [
      makeTestResult('proxy', '本地代理', 'warning', '未填写 API Key'),
      makeTestResult('text', '文字模型', 'warning', '未填写 API Key'),
      makeTestResult('vision', '视觉模型', 'warning', '未填写 API Key'),
      makeTestResult('image', '生图模型', 'warning', '未填写 API Key'),
    ];
  }
  const proxy = await testLocalProxy(settings);
  if (proxy.status === 'error') {
    return [
      proxy,
      makeTestResult('text', '文字模型', 'warning', '本地代理不可用，已跳过'),
      makeTestResult('vision', '视觉模型', 'warning', '本地代理不可用，已跳过'),
      makeTestResult('image', '生图模型', 'warning', '本地代理不可用，已跳过'),
    ];
  }
  const [text, vision, image] = await Promise.all([testTextModel(settings), testVisionModel(settings), testImageModel(settings)]);
  return [proxy, text, vision, image];
}

export async function classifyAssetsWithVision(settings: ModelScopeSettings, assets: AssetImage[], target: string): Promise<AssetClassification[]> {
  if (!isModelScopeReady(settings) || !settings.visionModel.trim() || assets.length === 0) return [];
  const prepared = await prepareReferenceImages(assets.slice(0, 8));
  const prompt = `You are a senior game UI technical artist.
Classify each cropped candidate image for a UI slicing workflow.
Target node: ${target}.
Return strict JSON only:
{"items":[{"index":0,"keep":true,"category":"ui_component | icon | ip_character | typography | background | discard","name":"file-safe English asset name without extension","componentType":"button | panel | nav bar | card | badge | progress bar | avatar frame | ticket | icon | character | text sample | background","confidence":0.0,"notes":"short reason"}]}
Rules: use zero-based image index; keep useful reusable UI assets; discard accidental fragments, noise, duplicated crops, and unreadable partial text.`;
  const data = await proxyChatCompletion(settings, {
    model: settings.visionModel,
    messages: [
      { role: 'system', content: 'Return strict JSON only. Do not use Markdown.' },
      { role: 'user', content: [{ type: 'text', text: prompt }, ...openAiImageContent(prepared)] },
    ],
    temperature: 0.05,
    max_tokens: 1800,
  });
  const text = String(data?.text || extractText(data?.raw) || '');
  const parsed = safeJson<{ items?: AssetClassification[] }>(text, {});
  return (parsed.items ?? [])
    .filter((item) => Number.isFinite(item.index))
    .map((item) => ({
      index: item.index,
      keep: item.keep !== false,
      category: item.category || 'ui_component',
      name: String(item.name || `asset-${item.index + 1}`).replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase(),
      componentType: item.componentType,
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.62,
      notes: item.notes,
    }));
}

export async function assessGeneratedImageQuality(settings: ModelScopeSettings, image: AssetImage, intent: string): Promise<GenerationQualityReport> {
  const fallback = (message: string): GenerationQualityReport => ({
    ok: true,
    score: 72,
    issues: [message],
    suggestions: ['建议人工检查组件是否包含多余角色、文字、水印、复杂背景或不可切片边界。'],
    provider: providerName(settings),
    model: settings.imageModel,
    promptSummary: intent.slice(0, 180),
  });
  if (!isModelScopeReady(settings) || !settings.visionModel.trim()) return fallback('未配置视觉模型，无法自动质检生图结果。');
  try {
    const prepared = await compressReferenceImage(image);
    const data = await proxyChatCompletion(settings, {
      model: settings.visionModel,
      messages: [
        { role: 'system', content: 'You are a strict game UI asset quality inspector. Return JSON only.' },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Inspect this generated image for a production game UI slicing workflow.
Intent: ${intent}
Return strict JSON: {"ok":true,"score":0-100,"issues":[""],"suggestions":[""]}
Score high only if it is reusable UI assets/components, visually coherent, clear boundaries, no readable text, no watermark, no mascot/animal/character as the main content, and suitable for PNG slicing.`,
            },
            ...openAiImageContent([prepared]),
          ],
        },
      ],
      temperature: 0.05,
      max_tokens: 700,
    });
    const text = String(data?.text || extractText(data?.raw) || '');
    const parsed = safeJson<Partial<GenerationQualityReport>>(text, {});
    return {
      ok: parsed.ok !== false && Number(parsed.score ?? 0) >= 60,
      score: typeof parsed.score === 'number' ? parsed.score : 70,
      issues: parsed.issues?.length ? parsed.issues : ['视觉质检未返回明确问题。'],
      suggestions: parsed.suggestions?.length ? parsed.suggestions : ['如风格不一致，请降低角色/贴纸权重，并改为分组件生成。'],
      provider: providerName(settings),
      model: settings.imageModel,
      promptSummary: intent.slice(0, 180),
    };
  } catch (error) {
    return fallback(`视觉质检失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function generateImageViaBackend(settings: ModelScopeSettings, prompt: string, negativePrompt: string, name: string): Promise<AssetImage> {
  const route = settings.provider === 'siliconflow' || settings.imageProtocol === 'siliconflow'
    ? '/api/siliconflow/generate-image'
    : settings.imageProtocol === 'dashscope-async'
      ? '/api/dashscope/generate-image'
      : '/api/modelscope/generate-image';
  const response = await fetchLocalProxy(settings, route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.imageModel,
      imagePath: settings.imagePath,
      taskPath: settings.taskPath,
      prompt,
      negativePrompt,
      size: settings.provider === 'siliconflow' ? undefined : '1024x1024',
      imageSize: settings.provider === 'siliconflow' ? '1328x1328' : '1024x1024',
      numInferenceSteps: settings.provider === 'siliconflow' ? 32 : undefined,
      guidanceScale: settings.provider === 'siliconflow' ? 4.5 : undefined,
      timeoutMs: settings.timeoutMs,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error || `${providerName(settings)} 本地代理 ${response.status}`);
  const output = extractImageUrl(data) ?? data?.dataUrl;
  if (!output) throw new Error(`${providerName(settings)} 本地代理没有返回图片：${summarizeValue(data)}`);
  return {
    id: crypto.randomUUID(),
    name,
    dataUrl: normalizeImageOutput(output),
    width: 1024,
    height: 1024,
  };
}

export async function testModelScopeConnection(settings: ModelScopeSettings): Promise<string> {
  const results = await testAiCapabilities(settings);
  const failed = results.find((result) => result.status === 'error');
  if (failed) throw new Error(`${failed.label}: ${failed.message}`);
  return results.map((result) => `${result.label}:${result.status}`).join(' / ');
}

export async function analyzeStyleWithModelScope(
  settings: ModelScopeSettings,
  promptText: string,
  images: AssetImage[],
  fallbackPalette: string[],
): Promise<StylePack> {
  if (images.length > 0 && !settings.visionModel.trim()) {
    throw new Error('已上传参考图，但未填写图片理解模型。请填写支持视觉输入的模型。');
  }
  const model = images.length > 0 ? settings.visionModel : settings.chatModel;
  if (!model) throw new Error('请先在 AI 设置里填写文字模型或图片理解模型名');

  const userText = `请基于用户需求和参考图，分析游戏 UI 视觉风格，并生成可直接用于文生图的系统化提示词。
用户需求：${promptText || '生成一套游戏 UI 切片风格包'}

要求：
- 参考图只作为风格参考，不要复制角色、吉祥物、截图布局、文字或场景内容。
- 提取 UI 视觉语言：色板、材质、边框、倒角、圆角、阴影、发光、装饰密度、布局节奏。
- 最终 prompt 必须面向可复用游戏 UI 资产：空按钮、面板、徽章、进度条、对话框、头像框、标签页、小装饰图标。
- 如果确实看到了图片，请在 visualEvidence 中列出至少 3 条具体证据。

输出严格 JSON：
{"name":"","description":"","palette":["#000000","#111111","#222222","#333333","#444444"],"material":"","shape":"","decoration":"","visualEvidence":[""],"visionStatus":"seen","prompt":"","negativePrompt":"","consistency":0}`;

  const systemMessage = {
    role: 'system',
    content: '你是资深游戏 UI 美术总监。你必须先观察参考图，再总结风格并转写成稳定、可复用的生图提示词。只输出 JSON。',
  };
  const compressedImages = images.length > 0 ? await prepareReferenceImages(images) : [];
  const attempts = compressedImages.length > 0
    ? [
      { label: 'openai-image-url', body: { model, messages: [systemMessage, { role: 'user', content: [{ type: 'text', text: userText }, ...openAiImageContent(compressedImages)] }], temperature: 0.35 } },
      { label: 'direct-image', body: { model, messages: [systemMessage, { role: 'user', content: [{ type: 'text', text: userText }, ...directImageContent(compressedImages)] }], temperature: 0.35 } },
      { label: 'top-level-images', body: { model, messages: [systemMessage, { role: 'user', content: userText }], images: compressedImages.map((image) => image.dataUrl), temperature: 0.35 } },
    ]
    : [
      { label: 'text-only', body: { model, messages: [systemMessage, { role: 'user', content: userText }], temperature: 0.35 } },
    ];

  const rawAttempts: string[] = [];
  let rawText = '';
  let parsed: Partial<StylePack> = {};
  for (const attempt of attempts) {
    try {
      const data = await postJson(settings, settings.chatPath, attempt.body);
      rawText = extractText(data);
      rawAttempts.push(`${attempt.label}: ${rawText || summarizeValue(data)}`);
      parsed = safeJson<Partial<StylePack>>(rawText, {});
      if (images.length === 0 || (parsed.visionStatus !== 'not_seen' && parsed.visualEvidence?.length)) break;
    } catch (error) {
      rawAttempts.push(`${attempt.label}: ${error instanceof Error ? error.message : '请求失败'}`);
    }
  }
  if (images.length > 0 && (parsed.visionStatus === 'not_seen' || !parsed.visualEvidence?.length)) {
    throw new Error(`图片理解模型没有返回可验证的参考图证据。模型返回：${rawAttempts.join(' | ').slice(0, 900)}`);
  }

  return {
    name: parsed.name || `${providerName(settings)} 风格包`,
    description: parsed.description || `由 ${providerName(settings)} 根据文本与参考图生成的游戏 UI 风格包。`,
    palette: parsed.palette?.length ? parsed.palette.slice(0, 5) : fallbackPalette,
    material: parsed.material || '由参考图提取的统一材质',
    shape: parsed.shape || '统一轮廓、清晰边框、适合切片',
    decoration: parsed.decoration || '装饰密度可控，保持 UI 可读性',
    prompt: strengthenPrompt(parsed, promptText, fallbackPalette),
    negativePrompt: strengthenNegativePrompt(parsed.negativePrompt),
    consistency: typeof parsed.consistency === 'number' ? parsed.consistency : 82,
    visualEvidence: parsed.visualEvidence ?? [],
    visionStatus: parsed.visionStatus ?? (images.length > 0 ? 'seen' : 'text_only'),
    rawModelSummary: rawText.slice(0, 500),
    source: 'modelscope',
  };
}

async function generateImage(settings: ModelScopeSettings, prompt: string, negativePrompt: string, name: string): Promise<AssetImage> {
  if (!settings.imageModel) throw new Error('请先在 AI 设置里填写生图模型名');
  if (settings.imageProtocol === 'modelscope-proxy' || settings.imageProtocol === 'dashscope-async' || settings.imageProtocol === 'siliconflow' || settings.provider === 'siliconflow') {
    return generateImageViaBackend(settings, prompt, negativePrompt, name);
  }
  const data = await postJson(settings, settings.imagePath, {
    model: settings.imageModel,
    prompt,
    negative_prompt: negativePrompt,
    size: '1024x1024',
    n: 1,
  });
  const output = extractImageUrl(data);
  if (!output) throw new Error(`${providerName(settings)} 生图返回中没有找到图片 URL 或 base64 数据。返回：${summarizeValue(data)}`);
  return {
    id: crypto.randomUUID(),
    name,
    dataUrl: normalizeImageOutput(output),
    width: 1024,
    height: 1024,
  };
}

export async function generateStylePreviewWithModelScope(settings: ModelScopeSettings, style: StylePack): Promise<AssetImage> {
  const prompt = `${style.prompt}
Create a single polished UI-only style board for a game UI kit.
Show 4 sample reusable interface assets: an empty button, an empty panel frame, a small badge frame, and a progress bar.
Use the reference-derived palette, material, border treatment, bevel, glow, shadow, and ornament density.
Do not include mascot characters, animal heads, dolls, stickers, people, screenshots, full app screens, or readable text.
Keep a clean layout, isolated assets, consistent style, transparent or simple neutral background.`;
  return generateImage(settings, prompt, style.negativePrompt, `${settings.provider || 'ai'}-style-preview.png`);
}

export async function generateComponentSheetWithModelScope(settings: ModelScopeSettings, style: StylePack, componentTypes: string[]): Promise<AssetImage> {
  const componentDescriptions = describeComponentTypes(componentTypes);
  const rows = Math.ceil(componentTypes.length / 2);
  const prompt = `${style.prompt}
Create a production-oriented game UI sprite sheet containing these separate reusable UI components: ${componentDescriptions}.
Requirements:
- exact layout: 2 columns x ${rows} rows, one centered component per cell, clear even spacing
- each asset must be a UI control/container, not a character, not a mascot, not a sticker
- each component must be visually different by function but share the same reference-derived UI art style
- isolated assets with clear padding around each item, full object visible, no overlap
- consistent camera angle, lighting, material, border treatment, ornament density, and color palette
- suitable for later PNG slicing and Unity UI import, clean rectangular/capsule silhouettes where appropriate
- no readable text, no watermark, no merged objects, no photographic background, no faces, no animal heads`;
  return generateImage(settings, prompt, style.negativePrompt, `${settings.provider || 'ai'}-component-sheet.png`);
}
