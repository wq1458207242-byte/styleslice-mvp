import http from 'node:http';

const PORT = Number(process.env.STYLESLICE_API_PORT || 8787);
const MODELSCOPE_BASE_URL = 'https://api-inference.modelscope.cn/v1';
const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';

const MODELSCOPE_TASK_PATHS = [
  '/images/generations/{task_id}',
  '/images/generations/{task_id}/result',
  '/images/generations/{task_id}/results',
  '/images/generations/{task_id}/status',
  '/images/generations?task_id={task_id}',
  '/images/generations/result?task_id={task_id}',
  '/images/generations/results?task_id={task_id}',
  '/tasks/{task_id}',
  '/tasks/{task_id}/result',
  '/tasks/{task_id}/results',
  '/tasks/{task_id}/status',
  '/task/{task_id}',
  '/task/{task_id}/result',
  '/task/{task_id}/status',
  '/jobs/{task_id}',
  '/jobs/{task_id}/result',
  '/jobs/{task_id}/status',
  '/async/tasks/{task_id}',
  '/async/tasks/{task_id}/result',
  '/results/{task_id}',
  'https://api-inference.modelscope.cn/api/v1/images/generations/{task_id}',
  'https://api-inference.modelscope.cn/api/v1/images/generations/{task_id}/result',
  'https://api-inference.modelscope.cn/api/v1/images/generations/{task_id}/status',
  'https://api-inference.modelscope.cn/api/v1/tasks/{task_id}',
  'https://api-inference.modelscope.cn/api/v1/tasks/{task_id}/result',
  'https://api-inference.modelscope.cn/api/v1/tasks/{task_id}/status',
  'https://api-inference.modelscope.cn/api/v1/task/{task_id}',
  'https://api-inference.modelscope.cn/api/v1/task/{task_id}/result',
  'https://api-inference.modelscope.cn/api/v1/jobs/{task_id}',
  'https://api-inference.modelscope.cn/api/v1/jobs/{task_id}/result',
];

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function endpoint(baseUrl, path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${String(baseUrl || '').replace(/\/$/, '')}/${String(path || '').replace(/^\//, '')}`;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { text };
  }
}

function errorMessage(data) {
  const errors = data?.errors ?? data?.error ?? data?.output?.errors;
  if (Array.isArray(errors)) return errors.map((item) => item?.message ?? item?.code ?? JSON.stringify(item)).join('；');
  if (errors && typeof errors === 'object') return errors.message ?? JSON.stringify(errors);
  if (typeof errors === 'string') return errors;
  return data?.message ?? data?.output?.message ?? data?.task_message ?? data?.text;
}

async function authedFetch(url, apiKey, provider, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = parseJson(text);
  if (!response.ok) {
    throw new Error(`${provider} ${response.status}: ${errorMessage(data) || text || response.statusText}`);
  }
  return data;
}

function extractTaskId(data) {
  return data?.output?.task_id ?? data?.task_id ?? data?.taskId ?? data?.id;
}

function extractRequestId(data) {
  return data?.request_id ?? data?.output?.request_id ?? data?.requestId;
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content
    ?? data?.output?.text
    ?? data?.text
    ?? data?.message
    ?? data?.output?.message
    ?? '';
  if (Array.isArray(content)) return content.map((part) => part?.text ?? '').join('\n').trim();
  return String(content).trim();
}

function taskStatus(data) {
  return String(data?.output?.task_status ?? data?.task_status ?? data?.status ?? data?.output?.status ?? '').toUpperCase();
}

function isSuccessStatus(status) {
  return ['SUCCEEDED', 'SUCCESS', 'COMPLETED', 'DONE', 'FINISHED'].includes(status);
}

function isFailureStatus(status) {
  return ['FAILED', 'ERROR', 'CANCELED', 'CANCELLED', 'UNKNOWN'].includes(status);
}

function hasErrors(data) {
  return Boolean(data?.errors || data?.error || data?.output?.errors);
}

function looksLikeBase64Image(value) {
  return typeof value === 'string' && value.length > 800 && /^[A-Za-z0-9+/=\s]+$/.test(value);
}

function extractImageUrl(value) {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('data:image/')) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/[)"'\]]+$/, '');
    const embeddedUrl = trimmed.match(/https?:\/\/[^\s"'<>),]+/i);
    if (embeddedUrl) return embeddedUrl[0];
    if (looksLikeBase64Image(trimmed)) return trimmed;
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractImageUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    for (const key of [
      'url',
      'image_url',
      'imageUrl',
      'b64_json',
      'base64',
      'base64_image',
      'image_base64',
      'image',
      'generated_image',
      'orig_image',
      'oss_url',
      'result_url',
      'content',
      'text',
    ]) {
      const found = extractImageUrl(value[key]);
      if (found) return found;
    }
    for (const nested of Object.values(value)) {
      const found = extractImageUrl(nested);
      if (found) return found;
    }
  }
  return undefined;
}

async function imageUrlToDataUrl(url, apiKey) {
  if (url.startsWith('data:image/')) return url;
  if (looksLikeBase64Image(url)) return `data:image/png;base64,${url}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`图片下载失败 ${response.status}: ${response.statusText}`);
  const contentType = response.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

function normalizeDashScopeModel(model) {
  const value = String(model || '').trim();
  if (/qwen[-_/]?image/i.test(value)) return 'qwen-image';
  return value || 'qwen-image';
}

async function generateDashScopeImage(body) {
  const apiKey = process.env.DASHSCOPE_API_KEY || body.apiKey;
  if (!apiKey) throw new Error('缺少 DashScope API Key：请填写 API Key，或设置环境变量 DASHSCOPE_API_KEY。');

  const model = normalizeDashScopeModel(body.model);
  const timeoutMs = Number(body.timeoutMs || 120000);
  const submit = await authedFetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', apiKey, 'DashScope', {
    method: 'POST',
    headers: { 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({
      model,
      input: {
        prompt: body.prompt,
        negative_prompt: body.negativePrompt,
      },
      parameters: {
        size: body.size || '1024*1024',
        n: 1,
      },
    }),
  });

  const taskId = extractTaskId(submit);
  if (!taskId) {
    const directUrl = extractImageUrl(submit);
    if (!directUrl) throw new Error(`DashScope 没有返回 task_id 或图片：${JSON.stringify(submit).slice(0, 800)}`);
    return { dataUrl: await imageUrlToDataUrl(directUrl, apiKey), taskId: undefined, raw: submit };
  }

  const startedAt = Date.now();
  let last = submit;
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    last = await authedFetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, apiKey, 'DashScope');
    const status = taskStatus(last);
    if (isSuccessStatus(status)) {
      const url = extractImageUrl(last);
      if (!url) throw new Error(`DashScope 任务成功但未找到图片 URL：${JSON.stringify(last).slice(0, 1000)}`);
      return { dataUrl: await imageUrlToDataUrl(url, apiKey), taskId, raw: last };
    }
    if (isFailureStatus(status)) {
      throw new Error(`DashScope 生图任务失败：${errorMessage(last) || JSON.stringify(last).slice(0, 1000)}`);
    }
  }
  throw new Error(`DashScope 生图任务超时：task_id=${taskId}，最后状态=${JSON.stringify(last).slice(0, 1000)}`);
}

async function generateSiliconFlowImage(body) {
  const apiKey = process.env.SILICONFLOW_API_KEY || body.apiKey;
  if (!apiKey) throw new Error('缺少 SiliconFlow API Key：请在 AI 设置里填写 API Key，或设置环境变量 SILICONFLOW_API_KEY。');

  const model = String(body.model || '').trim();
  if (!model) throw new Error('缺少 SiliconFlow 生图模型 ID。请在 AI 设置中填写硅基流动支持的图片生成模型。');

  const baseUrl = body.baseUrl || SILICONFLOW_BASE_URL;
  const imagePath = body.imagePath || '/images/generations';
  const isTurbo = /turbo/i.test(model);
  const isUiFriendlyModel = /qwen|z-image|tongyi|flux|kolors/i.test(model);
  const imageSize = body.imageSize || (isUiFriendlyModel ? '1328x1328' : '1024x1024');
  const numInferenceSteps = Number(body.numInferenceSteps || (isTurbo ? 32 : 45));
  const guidanceScale = Number(body.guidanceScale || (isUiFriendlyModel ? 4.5 : 7));
  const payload = {
    model,
    prompt: body.prompt,
    image_size: imageSize,
    batch_size: 1,
    num_inference_steps: numInferenceSteps,
    guidance_scale: guidanceScale,
  };
  if (body.negativePrompt) payload.negative_prompt = body.negativePrompt;
  if (body.seed != null && body.seed !== '') payload.seed = Number(body.seed);
  const data = await authedFetch(endpoint(baseUrl, imagePath), apiKey, 'SiliconFlow', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const url = extractImageUrl(data);
  if (!url) throw new Error(`SiliconFlow 生图成功但未找到图片 URL：${JSON.stringify(data).slice(0, 1000)}`);
  return {
    dataUrl: await imageUrlToDataUrl(url, apiKey),
    raw: data,
  };
}

async function testChatCompletion(body) {
  const apiKey = body.apiKey;
  if (!apiKey) throw new Error('缺少 API Key。');
  const model = String(body.model || '').trim();
  if (!model) throw new Error('请先填写文字模型或图片理解模型。');
  const baseUrl = body.baseUrl || SILICONFLOW_BASE_URL;
  const chatPath = body.chatPath || '/chat/completions';
  const data = await authedFetch(endpoint(baseUrl, chatPath), apiKey, body.providerName || 'AI Provider', {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a connectivity test assistant.' },
        { role: 'user', content: 'Reply with only ok.' },
      ],
      max_tokens: 8,
      temperature: 0,
    }),
  });
  return { ok: true, text: extractText(data) || 'ok', raw: data };
}

async function proxyChatCompletion(body) {
  const apiKey = process.env.SILICONFLOW_API_KEY || process.env.MODELSCOPE_API_KEY || body.apiKey;
  if (!apiKey) throw new Error('缺少 API Key。');
  const model = String(body.model || '').trim();
  if (!model) throw new Error('请先填写文字模型或图片理解模型。');
  const baseUrl = body.baseUrl || SILICONFLOW_BASE_URL;
  const chatPath = body.chatPath || '/chat/completions';
  const data = await authedFetch(endpoint(baseUrl, chatPath), apiKey, body.providerName || 'AI Provider', {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages: body.messages,
      temperature: body.temperature ?? 0.1,
      max_tokens: body.max_tokens ?? 1600,
      response_format: body.response_format,
    }),
  });
  return { ok: true, text: extractText(data), raw: data };
}

function configuredModelScopeTaskPaths(body, taskId) {
  const configuredPaths = String(body.taskPath || '')
    .split(/\n|,/)
    .map((path) => path.trim())
    .filter(Boolean)
    .filter((path) => !path.includes('request_id='));
  const paths = [...configuredPaths, ...MODELSCOPE_TASK_PATHS];
  return Array.from(new Set(paths.map((path) => path.replaceAll('{task_id}', taskId))));
}

function modelScopePollAttempts(body, taskId) {
  const baseUrl = body.baseUrl || MODELSCOPE_BASE_URL;
  const imagePath = body.imagePath || '/images/generations';
  const getAttempts = configuredModelScopeTaskPaths(body, taskId).map((path) => ({
    label: `GET ${endpoint(baseUrl, path)}`,
    url: endpoint(baseUrl, path),
    options: {
      method: 'GET',
      headers: { 'X-ModelScope-Async-Mode': 'true' },
    },
  }));
  const postAttempts = [
    ...configuredModelScopeTaskPaths(body, taskId).map((path) => ({
      label: `POST ${endpoint(baseUrl, path)} task_id`,
      url: endpoint(baseUrl, path),
      options: {
        method: 'POST',
        headers: { 'X-ModelScope-Async-Mode': 'true' },
        body: JSON.stringify({ model: body.model, task_id: taskId }),
      },
    })),
    {
      label: `POST ${endpoint(baseUrl, imagePath)} task_id+model`,
      url: endpoint(baseUrl, imagePath),
      options: {
        method: 'POST',
        headers: { 'X-ModelScope-Async-Mode': 'true' },
        body: JSON.stringify({ model: body.model, task_id: taskId }),
      },
    },
    {
      label: `POST ${endpoint(baseUrl, imagePath)} task_id`,
      url: endpoint(baseUrl, imagePath),
      options: {
        method: 'POST',
        headers: { 'X-ModelScope-Async-Mode': 'true' },
        body: JSON.stringify({ task_id: taskId }),
      },
    },
  ];
  return [...getAttempts, ...postAttempts];
}

async function pollModelScopeImageTask(body, apiKey, submit) {
  const taskId = extractTaskId(submit);
  const requestId = extractRequestId(submit);
  if (!taskId) {
    throw new Error(`ModelScope 返回异步结构但缺少 task_id。request_id=${requestId || '-'}，返回：${JSON.stringify(submit).slice(0, 1000)}`);
  }

  const timeoutMs = Math.max(Number(body.timeoutMs || 300000), 300000);
  const startedAt = Date.now();
  const attempts = [`initial response: ${JSON.stringify(submit).slice(0, 600)}`];
  let last = submit;

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    for (const attempt of modelScopePollAttempts(body, taskId)) {
      try {
        last = await authedFetch(attempt.url, apiKey, 'ModelScope', attempt.options);
        const image = extractImageUrl(last);
        if (image) return { image, taskId, requestId, raw: last, attempts };

        if (hasErrors(last)) throw new Error(errorMessage(last) || JSON.stringify(last).slice(0, 600));

        const status = taskStatus(last);
        if (isFailureStatus(status)) {
          throw new Error(errorMessage(last) || JSON.stringify(last).slice(0, 600));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push(`${attempt.label}: ${message}`);
      }
    }
  }

  throw new Error(`ModelScope 生图任务轮询超时或未找到结果。task_id=${taskId}，request_id=${requestId || '-'}。尝试记录：${attempts.slice(-10).join(' | ')}。最后返回：${JSON.stringify(last).slice(0, 1000)}`);
}

async function generateModelScopeImage(body) {
  const apiKey = process.env.MODELSCOPE_API_KEY || body.apiKey;
  if (!apiKey) throw new Error('缺少 ModelScope API Key：请在 AI 设置里填写 API Key，或设置环境变量 MODELSCOPE_API_KEY。');

  const model = String(body.model || '').trim();
  if (!model) throw new Error('缺少 ModelScope 生图模型 ID。请填写 ModelScope API-Inference 中可用的文生图模型。');

  const baseUrl = body.baseUrl || MODELSCOPE_BASE_URL;
  const imagePath = body.imagePath || '/images/generations';
  const submit = await authedFetch(endpoint(baseUrl, imagePath), apiKey, 'ModelScope', {
    method: 'POST',
    headers: { 'X-ModelScope-Async-Mode': 'true' },
    body: JSON.stringify({
      model,
      prompt: body.prompt,
      negative_prompt: body.negativePrompt,
      size: body.size || '1024x1024',
      n: 1,
      response_format: 'url',
    }),
  });

  if (hasErrors(submit)) {
    throw new Error(`ModelScope 生图请求失败：${errorMessage(submit) || JSON.stringify(submit).slice(0, 1000)}。请检查生图模型 ID 是否支持 API-Inference 的 /images/generations。`);
  }

  const directImage = extractImageUrl(submit);
  if (directImage) {
    return { dataUrl: await imageUrlToDataUrl(directImage, apiKey), taskId: extractTaskId(submit), requestId: extractRequestId(submit), raw: submit };
  }

  if (extractTaskId(submit)) {
    const result = await pollModelScopeImageTask(body, apiKey, submit);
    return {
      dataUrl: await imageUrlToDataUrl(result.image, apiKey),
      taskId: result.taskId,
      requestId: result.requestId,
      raw: result.raw,
      attempts: result.attempts,
    };
  }

  throw new Error(`ModelScope 生图没有返回图片或 task_id：${JSON.stringify(submit).slice(0, 1000)}`);
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 200, { ok: true });
    return;
  }

  try {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { ok: true, service: 'styleslice-api' });
      return;
    }

    if (request.method === 'POST' && request.url === '/api/dashscope/generate-image') {
      const body = await readJson(request);
      const result = await generateDashScopeImage(body);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === 'POST' && request.url === '/api/modelscope/generate-image') {
      const body = await readJson(request);
      const result = await generateModelScopeImage(body);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === 'POST' && request.url === '/api/siliconflow/generate-image') {
      const body = await readJson(request);
      const result = await generateSiliconFlowImage(body);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === 'POST' && request.url === '/api/provider/test-chat') {
      const body = await readJson(request);
      const result = await testChatCompletion(body);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === 'POST' && request.url === '/api/provider/chat-completion') {
      const body = await readJson(request);
      const result = await proxyChatCompletion(body);
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, { message: 'Not found' });
  } catch (error) {
    sendJson(response, 500, { message: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`StyleSlice API listening on http://127.0.0.1:${PORT}`);
});
