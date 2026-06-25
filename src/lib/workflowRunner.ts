import type { Edge } from '@xyflow/react';
import { componentTypesFromPlan, normalizeComponentPlan } from '../data/componentCatalog';
import {
  decomposeReferenceImage,
  extractPalette,
  generateAnalysisCard,
  generateAssetContactSheet,
  generateComponentSheet,
  generateScreenMockup,
  sliceComponentSheet,
} from './imagePipeline';
import {
  analyzeStyleWithModelScope,
  assessGeneratedImageQuality,
  classifyAssetsWithVision,
  generateComponentSheetWithModelScope,
  generateScreenImageWithModelScope,
  generateStylePreviewWithModelScope,
  isModelScopeReady,
} from './modelscopeClient';
import type {
  AssetClassification,
  AssetImage,
  ModelScopeSettings,
  SliceAsset,
  WorkflowNode,
  WorkflowNodeData,
} from '../types/workflow';

export interface RunContext {
  node: WorkflowNode;
  inputs: WorkflowNode[];
  aiSettings: ModelScopeSettings;
}

type NodeExecutor = (context: RunContext) => Promise<Partial<WorkflowNodeData>>;
type DecompositionKind = 'componentLibrary' | 'background' | 'ip' | 'icon' | 'typography';

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const localComponentTypes = ['按钮', '面板', '徽章', '进度条', '对话框', '头像框'];

function compactError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 480 ? `${message.slice(0, 480)}…` : message;
}

function nodeOutputImages(input: WorkflowNode): AssetImage[] {
  return [
    ...(input.data.images ?? []),
    ...(input.data.stylePreview ? [input.data.stylePreview] : []),
    ...(input.data.screenImage ? [input.data.screenImage] : []),
    ...(input.data.sheet ? [input.data.sheet] : []),
    ...(input.data.extractedAssets ?? []),
    ...(input.data.slices ?? []),
  ];
}

function inputImages(inputs: WorkflowNode[]) {
  return inputs.flatMap(nodeOutputImages);
}

function mainInputImage(inputs: WorkflowNode[]) {
  const imageNode = inputs.find((input) => input.data.images?.length);
  const images = imageNode?.data.images ?? [];
  const index = Math.min(Math.max(imageNode?.data.activeImageIndex ?? 0, 0), Math.max(images.length - 1, 0));
  return images[index] ?? images[0] ?? inputImages(inputs)[0];
}

function firstUpstreamStylePack(inputs: WorkflowNode[]) {
  return inputs.find((input) => input.data.stylePack)?.data.stylePack;
}

function firstUpstreamComponentTypes(inputs: WorkflowNode[]) {
  return inputs.find((input) => input.data.componentTypes?.length)?.data.componentTypes;
}

function applyClassifications(assets: AssetImage[], classifications: AssetClassification[], fallbackCategory: string) {
  if (classifications.length === 0) return assets;
  const byIndex = new Map(classifications.map((item) => [item.index, item]));
  return assets
    .map((asset, index) => {
      const classification = byIndex.get(index);
      if (classification?.keep === false) return undefined;
      const name = classification?.name || `${fallbackCategory}-${String(index + 1).padStart(2, '0')}`;
      return {
        ...asset,
        name: `${name.replace(/\.png$/i, '')}.png`,
      };
    })
    .filter((asset): asset is AssetImage => Boolean(asset));
}

function assetsToSlices(assets: AssetImage[], fallbackCategory: string, classifications: AssetClassification[]): SliceAsset[] {
  const byIndex = new Map(classifications.map((item) => [item.index, item]));
  return assets.map((asset, index) => {
    const classification = byIndex.get(index);
    const category = classification?.componentType || classification?.category || fallbackCategory;
    const lower = category.toLowerCase();
    const suggestedBorder: [number, number, number, number] = lower.includes('panel') || lower.includes('button') || lower.includes('card') || category.includes('面板') || category.includes('按钮') || category.includes('卡片')
      ? [32, 32, 32, 32]
      : [0, 0, 0, 0];
    return {
      ...asset,
      category,
      state: 'normal',
      suggestedBorder,
    };
  });
}

async function localAssetDecomposition(
  title: string,
  kind: DecompositionKind,
  inputs: WorkflowNode[],
  lines: string[],
  aiSettings?: ModelScopeSettings,
  componentTypes?: string[],
) {
  const images = inputImages(inputs);
  const main = mainInputImage(inputs);
  if (!main) throw new Error('请先连接参考图、界面图、组件板或切片资产节点');

  const palette = await extractPalette(images);
  const rawAssets = await decomposeReferenceImage(main, kind);
  let classifications: AssetClassification[] = [];
  let classifyMessage = '未启用 AI 视觉分类，当前使用本地候选区域。';

  if (aiSettings && isModelScopeReady(aiSettings) && aiSettings.visionModel.trim() && rawAssets.length > 0) {
    try {
      classifications = await classifyAssetsWithVision(aiSettings, rawAssets, kind);
      classifyMessage = `AI 已完成 ${classifications.length} 个候选资产的分类、过滤与命名。`;
    } catch (error) {
      classifyMessage = `AI 视觉分类失败，已保留本地候选资产：${compactError(error)}`;
    }
  }

  const extractedAssets = applyClassifications(rawAssets, classifications, kind);
  const slices = assetsToSlices(extractedAssets, kind, classifications);
  const inferredTypes = classifications
    .filter((item) => item.keep !== false && item.componentType)
    .map((item) => item.componentType!)
    .filter(Boolean);

  return {
    stylePack: {
      name: `${title}风格约束`,
      description: '由上游图像资产提取的轻量风格约束，可继续连接到组件生成或界面生成节点。',
      palette,
      material: '由上游图像资产推导的统一材质',
      shape: '由上游图像资产推导的形状语言',
      decoration: '由上游图像资产推导的装饰密度',
      prompt: `${title}, reusable game UI assets, ${palette.join(', ')}, consistent palette and material`,
      negativePrompt: 'low quality, watermark, noisy background, inconsistent style, unreadable text',
      consistency: 82,
      source: 'local' as const,
    },
    stylePreview: await generateAssetContactSheet(title, extractedAssets, palette),
    extractedAssets,
    slices,
    classifications,
    componentTypes: componentTypes ?? (inferredTypes.length ? Array.from(new Set(inferredTypes)) : undefined),
    analysisItems: [
      ...lines,
      classifyMessage,
      `已从主图生成 ${extractedAssets.length} 个候选切片；可继续连接到切片与质检节点或 Unity 导出节点。`,
    ],
    message: `已完成 ${extractedAssets.length} 个候选资产拆解与切片：${title}`,
  };
}

const executors: Record<string, NodeExecutor> = {
  text: async ({ node }) => ({
    message: node.data.text?.trim() ? '需求已就绪' : '请补充游戏类型、目标界面、组件类型和风格约束',
  }),

  images: async ({ node }) => ({
    message: `${node.data.images?.length ?? 0} 张参考图已就绪`,
  }),

  palette: async ({ inputs }) => {
    const images = inputImages(inputs);
    if (images.length === 0) throw new Error('请先连接参考图、界面图、组件板或切片资产节点');
    const palette = await extractPalette(images);
    const lines = [
      `主色倾向：${palette[0]} / ${palette[1]}`,
      `辅助色：${palette[2]} / ${palette[3]}`,
      `强调色：${palette[4]}`,
      '建议输出为 UI token：primary / surface / accent / warning / text',
      '后续可用于约束生图提示词、组件板和导出元数据',
    ];
    return {
      stylePack: {
        name: '参考图色板',
        description: '由参考图本地采样聚类得到的色彩搭配。',
        palette,
        material: '由参考图色彩推导',
        shape: '不涉及形状',
        decoration: '不涉及装饰',
        prompt: `game UI color palette, ${palette.join(', ')}, cohesive UI assets`,
        negativePrompt: 'inconsistent colors, low contrast, noisy palette',
        consistency: 88,
        source: 'local',
      },
      stylePreview: generateAnalysisCard('色板拆解', lines, palette),
      analysisItems: lines,
      message: `已提取 ${palette.length} 个核心色板，可作为后续节点的颜色约束`,
    };
  },

  componentLibrary: async ({ inputs, aiSettings }) => localAssetDecomposition('组件库拆解', 'componentLibrary', inputs, [
    '候选组件：顶部导航、返回按钮、信息卡片、进度圆环、徽章、兑换券按钮。',
    '当前采用本地候选区域检测 + 可选 AI 视觉分类；适合作为组件生成清单和人工筛选入口。',
    '后续建议加入可编辑裁切框，允许手动微调自动识别的区域。',
  ], aiSettings, ['顶部导航', '返回按钮', '信息卡片', '进度圆环', '徽章', '兑换券按钮']),

  background: async ({ inputs, aiSettings }) => localAssetDecomposition('底图拆解', 'background', inputs, [
    '识别背景层、渐变、暗纹、光斑与大面积底色。',
    '建议背景和 UI 组件分层导出，避免把文字或角色烘焙进底图。',
    '后续可接入图像修复或重绘模型生成 clean plate。',
  ], aiSettings),

  ip: async ({ inputs, aiSettings }) => localAssetDecomposition('IP 角色拆解', 'ip', inputs, [
    '识别参考图中的角色/IP/吉祥物区域。',
    'IP 应和 UI 组件分离生产，避免组件板变成角色贴纸包。',
    '可拆资产：全身立绘、头像、表情、动作、头像框装饰。',
  ], aiSettings),

  icon: async ({ inputs, aiSettings }) => localAssetDecomposition('Icon 拆解', 'icon', inputs, [
    '识别返回箭头、编辑笔、奖章、票券、星光、资源符号等小图标。',
    '图标建议独立小尺寸生成，统一描边、投影和高光。',
    '后续可按 icon set 单独导出。',
  ], aiSettings),

  typography: async ({ inputs, aiSettings }) => localAssetDecomposition('字体拆解', 'typography', inputs, [
    '识别标题、导航、数字、按钮文字等字体样本区域。',
    '浏览器端无法稳定识别具体字体名；当前更适合沉淀字重、描边、阴影和字号 token。',
    '后续可接 Tesseract.js 做 OCR 区域检测，字体名仍建议人工确认商用授权。',
  ], aiSettings),

  style: async ({ inputs, aiSettings }) => {
    const images = inputImages(inputs);
    const text = inputs.map((input) => input.data.text).filter(Boolean).join(' ');
    const upstreamStylePack = firstUpstreamStylePack(inputs);
    const palette = images.length > 0 ? await extractPalette(images) : upstreamStylePack?.palette ?? [];

    if (isModelScopeReady(aiSettings)) {
      const stylePack = await analyzeStyleWithModelScope(aiSettings, text, images, palette);
      let stylePreview: WorkflowNodeData['stylePreview'];
      let previewError = '';
      if (aiSettings.imageModel.trim()) {
        try {
          stylePreview = await generateStylePreviewWithModelScope(aiSettings, stylePack);
          const qualityReport = await assessGeneratedImageQuality(aiSettings, stylePreview, 'style preview board with reusable game UI components');
          return {
            stylePack,
            stylePreview,
            qualityReport,
            message: qualityReport.ok
              ? `已完成多模态风格分析，并生成 AI 预览图。视觉质检：${qualityReport.score}/100`
              : `已完成多模态风格分析，但 AI 预览图质检偏低：${qualityReport.score}/100。问题：${qualityReport.issues.join('；')}`,
          };
        } catch (error) {
          previewError = compactError(error);
          stylePreview = generateComponentSheet(stylePack, localComponentTypes);
          stylePreview.name = 'local-style-preview-fallback.png';
        }
      }
      return {
        stylePack,
        stylePreview,
        message: stylePreview
          ? previewError
            ? `已完成多模态风格分析；AI 预览图失败，已回退为本地风格预览。诊断：${previewError}`
            : '已完成多模态风格分析，并生成提示词效果预览'
          : '已完成多模态风格分析；未填写生图模型，跳过效果预览',
      };
    }

    return {
      stylePack: {
        name: images.length > 0 ? '图像资产衍生风格' : upstreamStylePack?.name ?? '默认游戏 UI 风格',
        description: '本地模式根据参考图色板和文本需求生成基础风格包。',
        palette: palette.length ? palette : ['#f5a6c7', '#d5a1f2', '#fff1b9', '#85d1e2', '#4a90e2'],
        material: upstreamStylePack?.material ?? '由上游图像资产推导的统一材质',
        shape: upstreamStylePack?.shape ?? '清晰轮廓、可切片边框、适中圆角',
        decoration: upstreamStylePack?.decoration ?? '装饰密度可控，避免影响 UI 可读性',
        prompt: `${text || upstreamStylePack?.prompt || 'game UI kit'}, isolated UI assets, cohesive material, clean spacing, transparent background`,
        negativePrompt: upstreamStylePack?.negativePrompt ?? 'illegible text, watermark, merged objects, busy background, inconsistent perspective',
        consistency: images.length >= 3 ? 86 : 72,
        source: 'local',
      },
      message: images.length >= 3 ? '已从参考图提取本地风格包；启用 AI 可生成更精确的提示词和预览图' : '参考图不足 3 张，已使用稳健默认值',
    };
  },

  screen: async ({ node, inputs, aiSettings }) => {
    const stylePack = firstUpstreamStylePack(inputs);
    if (!stylePack) throw new Error('请先连接并运行设计风格包、色板节点或其他可输出风格约束的资产分析节点');
    const upstreamText = inputs
      .filter((input) => input.data.kind === 'text')
      .map((input) => input.data.text)
      .filter(Boolean)
      .join('；');
    const screenPrompt = [upstreamText, node.data.text].filter(Boolean).join('；') || '完整游戏主界面';

    if (isModelScopeReady(aiSettings) && aiSettings.imageModel.trim()) {
      try {
        const screenImage = await generateScreenImageWithModelScope(aiSettings, stylePack, screenPrompt);
        const qualityReport = await assessGeneratedImageQuality(aiSettings, screenImage, `full game UI screen: ${screenPrompt}`);
        return {
          screenImage,
          qualityReport,
          message: qualityReport.ok
            ? `已根据风格包生成完整界面图。视觉质检：${qualityReport.score}/100`
            : `已生成完整界面图，但视觉质检偏低：${qualityReport.score}/100。问题：${qualityReport.issues.join('；')}`,
        };
      } catch (error) {
        return {
          screenImage: generateScreenMockup(stylePack, screenPrompt),
          message: `AI 完整界面生图失败，已回退为本地结构化界面稿。诊断：${compactError(error)}`,
        };
      }
    }

    return {
      screenImage: generateScreenMockup(stylePack, screenPrompt),
      message: '未配置生图模型，已生成本地结构化完整界面稿',
    };
  },

  components: async ({ node, inputs, aiSettings }) => {
    const stylePack = firstUpstreamStylePack(inputs);
    if (!stylePack) throw new Error('请先连接并运行设计风格包、色板节点或其他可输出风格约束的资产分析节点');
    const libraryTypes = firstUpstreamComponentTypes(inputs);
    const componentPlan = normalizeComponentPlan(node.data.componentPlan, node.data.componentTypes?.length ? node.data.componentTypes : libraryTypes);
    const componentTypes = componentTypesFromPlan(componentPlan, node.data.componentTypes?.length ? node.data.componentTypes : libraryTypes);
    const batchCount = Math.max(1, Math.ceil(componentTypes.length / 8));

    if (isModelScopeReady(aiSettings) && aiSettings.imageModel.trim()) {
      try {
        const sheet = await generateComponentSheetWithModelScope(aiSettings, stylePack, componentTypes);
        const qualityReport = await assessGeneratedImageQuality(aiSettings, sheet, `component sheet: ${componentTypes.join(', ')}`);
        return {
          sheet,
          componentPlan,
          componentTypes,
          qualityReport,
          message: qualityReport.ok
            ? `已根据风格包调用生图模型生成 ${componentTypes.length} 类组件。视觉质检：${qualityReport.score}/100`
            : `已生成组件板，但视觉质检偏低：${qualityReport.score}/100。问题：${qualityReport.issues.join('；')}`,
        };
      } catch (error) {
        return {
          sheet: generateComponentSheet(stylePack, componentTypes),
          componentPlan,
          componentTypes,
          message: `AI 生图失败，已回退成本地风格化组件板。诊断：${compactError(error)}`,
        };
      }
    }

    return {
      sheet: generateComponentSheet(stylePack, componentTypes),
      componentPlan,
      componentTypes,
      message: `未配置生图模型，已生成 ${componentTypes.length} 个本地占位组件`,
    };
  },

  slice: async ({ inputs }) => {
    const existingSlices = inputs.flatMap((input) => input.data.slices ?? []);
    if (existingSlices.length > 0) return { slices: existingSlices, message: `${existingSlices.length} 个 AI/本地分类切片通过基础质检` };

    const extractedAssets = inputs.flatMap((input) => input.data.extractedAssets ?? []);
    if (extractedAssets.length > 0) {
      const slices = assetsToSlices(extractedAssets, 'detected', []);
      return { slices, message: `${slices.length} 个拆解候选资产已转换为切片` };
    }

    const componentNode = inputs.find((input) => input.data.sheet);
    if (!componentNode?.data.sheet) throw new Error('请先连接并运行原子组件板节点');
    const sliceTypes = componentTypesFromPlan(componentNode.data.componentPlan, componentNode.data.componentTypes ?? localComponentTypes);
    const slices = await sliceComponentSheet(componentNode.data.sheet, sliceTypes);
    return { slices, message: `${slices.length} 个切片通过基础质检` };
  },

  export: async ({ inputs }) => {
    const count = inputs.flatMap((input) => input.data.slices ?? []).length;
    if (count === 0) throw new Error('没有可导出的切片');
    return { message: `${count} 个资产已准备导出` };
  },
};

export async function runNode(node: WorkflowNode, allNodes: WorkflowNode[], edges: Edge[], aiSettings: ModelScopeSettings) {
  const sourceIds = edges.filter((edge) => edge.target === node.id).map((edge) => edge.source);
  const inputs = sourceIds
    .map((id) => allNodes.find((item) => item.id === id))
    .filter((item): item is WorkflowNode => Boolean(item));
  await wait(240);
  return executors[node.data.kind]({ node, inputs, aiSettings });
}

export function getExecutionOrder(nodes: WorkflowNode[], edges: Edge[]) {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  edges.forEach((edge) => indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1));
  const queue = nodes.filter((node) => indegree.get(node.id) === 0);
  const result: WorkflowNode[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    edges.filter((edge) => edge.source === current.id).forEach((edge) => {
      const next = (indegree.get(edge.target) ?? 0) - 1;
      indegree.set(edge.target, next);
      if (next === 0) {
        const target = nodes.find((node) => node.id === edge.target);
        if (target) queue.push(target);
      }
    });
  }
  if (result.length !== nodes.length) throw new Error('工作流存在循环连接，请先移除环路');
  return result;
}
