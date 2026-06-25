import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type ReactFlowInstance,
  type EdgeMouseHandler,
  type OnNodeDrag,
  useEdgesState,
  useNodesState,
  type Connection,
  type NodeTypes,
} from '@xyflow/react';
import JSZip from 'jszip';
import { componentTypesFromPlan, normalizeComponentPlan } from '../data/componentCatalog';
import { createNodeData, NODE_ORDER, NODE_REGISTRY } from '../data/nodeRegistry';
import { dataUrlToBlob } from '../lib/imagePipeline';
import { DEFAULT_MODELSCOPE_SETTINGS, PROVIDER_PRESETS } from '../lib/modelscopeClient';
import { getExecutionOrder, runNode } from '../lib/workflowRunner';
import type {
  AssetImage,
  ModelScopeSettings,
  NodeKind,
  ProjectSettings,
  ProjectSnapshot,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeData,
} from '../types/workflow';
import { AiSettingsPanel } from './AiSettingsPanel';
import { Inspector } from './Inspector';
import { NodePalette, NODE_PALETTE_DRAG_TYPE } from './NodePalette';
import { StatusBar } from './StatusBar';
import { StudioNode } from './StudioNode';
import { TopBar } from './TopBar';

const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  name: '暗金幻想 · UI Kit',
  engine: 'Unity',
  resolution: '1920 × 1080',
  pixelArt: false,
};
const LEGACY_STORAGE_KEY = 'styleslice-project-v1';
const PROJECT_INDEX_KEY = 'styleslice-project-index-v1';
const ACTIVE_PROJECT_KEY = 'styleslice-active-project-id';
const AI_STORAGE_KEY = 'styleslice-modelscope-settings-v1';
const NODE_CLIPBOARD_PREFIX = 'styleslice:nodes:';
const FREE_EDGE_STYLE = {
  stroke: '#7c879a',
  strokeDasharray: '6 5',
};
const LAYOUT_COLUMNS: Record<NodeKind, number> = {
  text: 0,
  images: 0,
  palette: 1,
  componentLibrary: 1,
  background: 1,
  ip: 1,
  icon: 1,
  typography: 1,
  style: 1,
  screen: 2,
  components: 2,
  slice: 3,
  export: 4,
};
const LAYOUT_BASE_X = 80;
const LAYOUT_BASE_Y = 180;
const LAYOUT_COLUMN_GAP = 360;
const LAYOUT_ROW_GAP = 240;

interface QuickCreateMenuState {
  sourceId: string;
  sourceHandle?: string | null;
  screen: { x: number; y: number };
  position: { x: number; y: number };
}

interface DraggedImagePayload {
  sourceNodeId?: string;
  imageId?: string;
}

const DECOMPOSITION_KINDS: NodeKind[] = ['palette', 'componentLibrary', 'background', 'ip', 'icon', 'typography'];

const initialNodes: WorkflowNode[] = [
  { id: 'text-1', type: 'studio', position: { x: 50, y: 70 }, data: createNodeData('text') },
  { id: 'images-1', type: 'studio', position: { x: 50, y: 310 }, data: createNodeData('images') },
  { id: 'style-1', type: 'studio', position: { x: 370, y: 190 }, data: createNodeData('style') },
  { id: 'components-1', type: 'studio', position: { x: 690, y: 190 }, data: createNodeData('components') },
  { id: 'slice-1', type: 'studio', position: { x: 1010, y: 190 }, data: createNodeData('slice') },
  { id: 'export-1', type: 'studio', position: { x: 1330, y: 190 }, data: createNodeData('export') },
];

const initialEdges: WorkflowEdge[] = [
  { id: 'e-text-style', source: 'text-1', target: 'style-1' },
  { id: 'e-images-style', source: 'images-1', target: 'style-1' },
  { id: 'e-style-components', source: 'style-1', target: 'components-1' },
  { id: 'e-components-slice', source: 'components-1', target: 'slice-1' },
  { id: 'e-slice-export', source: 'slice-1', target: 'export-1' },
];

interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
}

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function projectStorageKey(id: string) {
  return `styleslice-project-${id}`;
}

function createProjectId() {
  return `project-${crypto.randomUUID().slice(0, 8)}`;
}

function createProjectSettings(name = '未命名 UI Kit'): ProjectSettings {
  return {
    ...DEFAULT_PROJECT_SETTINGS,
    name,
  };
}

function createProjectSnapshot(name = '未命名 UI Kit', aiSettings?: ModelScopeSettings): ProjectSnapshot {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: createProjectId(),
    settings: createProjectSettings(name),
    aiSettings,
    nodes: normalizeNodes(initialNodes),
    edges: initialEdges,
    savedAt: now,
  };
}

function readProjectIndex() {
  return readJson<ProjectMeta[]>(PROJECT_INDEX_KEY) ?? [];
}

function writeProjectIndex(projects: ProjectMeta[]) {
  localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(projects));
}

function upsertProjectMeta(projects: ProjectMeta[], snapshot: ProjectSnapshot): ProjectMeta[] {
  const id = snapshot.id ?? createProjectId();
  const meta = {
    id,
    name: snapshot.settings.name || '未命名 UI Kit',
    updatedAt: snapshot.savedAt,
  };
  const rest = projects.filter((project) => project.id !== id);
  return [meta, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function saveProjectSnapshot(snapshot: ProjectSnapshot, projects = readProjectIndex()) {
  const id = snapshot.id ?? createProjectId();
  const nextSnapshot = { ...snapshot, id };
  localStorage.setItem(projectStorageKey(id), JSON.stringify(nextSnapshot));
  localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  const nextProjects = upsertProjectMeta(projects, nextSnapshot);
  writeProjectIndex(nextProjects);
  return { snapshot: nextSnapshot, projects: nextProjects };
}

function loadProjectSnapshot(id: string) {
  return readJson<ProjectSnapshot>(projectStorageKey(id));
}

function loadInitialProject() {
  const indexedProjects = readProjectIndex();
  const activeId = localStorage.getItem(ACTIVE_PROJECT_KEY);
  const indexedId = activeId ?? indexedProjects[0]?.id;
  const indexedSnapshot = indexedId ? loadProjectSnapshot(indexedId) : null;
  if (indexedSnapshot) {
    return {
      snapshot: indexedSnapshot,
      projects: indexedProjects.length ? indexedProjects : upsertProjectMeta([], indexedSnapshot),
    };
  }

  const legacy = readJson<ProjectSnapshot>(LEGACY_STORAGE_KEY);
  if (legacy) {
    const migrated = {
      ...legacy,
      id: legacy.id ?? createProjectId(),
      settings: {
        ...createProjectSettings(legacy.settings?.name || '迁移项目'),
        ...(legacy.settings ?? {}),
      },
      nodes: normalizeNodes(legacy.nodes ?? initialNodes),
      edges: legacy.edges ?? initialEdges,
      savedAt: legacy.savedAt ?? new Date().toISOString(),
    };
    return saveProjectSnapshot(migrated, indexedProjects);
  }

  const created = createProjectSnapshot('我的 UI Kit', readJson<ModelScopeSettings>(AI_STORAGE_KEY) ?? undefined);
  return saveProjectSnapshot(created, indexedProjects);
}

function statusFromMessage(message?: string) {
  return message?.includes('不足') || message?.includes('失败') || message?.includes('回退') ? 'warning' : 'success';
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
}

function isRecommendedConnection(source?: WorkflowNode, target?: WorkflowNode) {
  if (!source || !target) return false;
  if (source.id === target.id) return false;
  return NODE_REGISTRY[target.data.kind].accepts.includes(source.data.kind);
}

function pointerFromConnectEvent(event: MouseEvent | TouchEvent) {
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    return {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
    };
  }
  return {
    x: (event as MouseEvent).clientX,
    y: (event as MouseEvent).clientY,
  };
}

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
}

function fileToAssetImage(file: File): Promise<AssetImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      id: crypto.randomUUID(),
      name: file.name || `pasted-image-${Date.now()}.png`,
      dataUrl: String(reader.result),
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function filesToAssetImages(files: File[]) {
  return Promise.all(files.filter(isImageFile).map(fileToAssetImage));
}

function decorateEdge(edge: WorkflowEdge, nodes: WorkflowNode[]): WorkflowEdge {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  const recommended = isRecommendedConnection(source, target);
  return {
    ...edge,
    animated: recommended,
    label: recommended ? undefined : '自由连接',
    style: recommended ? edge.style : { ...FREE_EDGE_STYLE, ...edge.style },
    data: {
      ...(edge.data ?? {}),
      recommended,
    },
  };
}

function normalizeNodes(nodes: WorkflowNode[]) {
  return nodes.map((node) => {
    const definition = NODE_REGISTRY[node.data.kind];
    if (!definition) return node;
    const normalizedData: WorkflowNodeData = {
      ...node.data,
      title: definition.label,
      description: definition.description,
    };
    if (node.data.kind === 'components') {
      normalizedData.componentTypes = node.data.componentTypes?.length ? node.data.componentTypes : ['按钮', '面板', '徽章', '进度条', '对话框', '头像框'];
    }
    if (node.data.kind === 'components') {
      normalizedData.componentPlan = normalizeComponentPlan(node.data.componentPlan, node.data.componentTypes);
      normalizedData.componentTypes = componentTypesFromPlan(normalizedData.componentPlan, node.data.componentTypes);
    }
    return { ...node, data: normalizedData };
  });
}

function normalizeAiSettings(settings: ModelScopeSettings): ModelScopeSettings {
  const next = { ...settings };
  const providerHint = [
    next.provider,
    next.baseUrl,
    next.imageProtocol,
    next.imageModel,
  ].join(' ').toLowerCase();
  if (providerHint.includes('siliconflow') || providerHint.includes('siliconflow.cn')) {
    next.provider = 'siliconflow';
  } else if (!next.provider) {
    next.provider = 'modelscope';
  }
  if (next.provider === 'siliconflow' && !next.baseUrl?.includes('siliconflow.cn')) {
    next.baseUrl = PROVIDER_PRESETS.siliconflow.baseUrl || 'https://api.siliconflow.cn/v1';
  }
  if (next.provider === 'siliconflow' && next.imageProtocol !== 'siliconflow') {
    next.imageProtocol = 'siliconflow';
  }
  next.providerKeys = {
    ...(next.providerKeys ?? {}),
    [next.provider]: next.providerKeys?.[next.provider] ?? next.apiKey ?? '',
  };
  if (!next.apiKey && next.providerKeys[next.provider]) {
    next.apiKey = next.providerKeys[next.provider] ?? '';
  }
  const preset = PROVIDER_PRESETS[next.provider];
  next.baseUrl = next.baseUrl || preset.baseUrl || DEFAULT_MODELSCOPE_SETTINGS.baseUrl;
  next.chatPath = next.chatPath || preset.chatPath || DEFAULT_MODELSCOPE_SETTINGS.chatPath;
  next.imagePath = next.imagePath || preset.imagePath || DEFAULT_MODELSCOPE_SETTINGS.imagePath;
  next.imageProtocol = next.imageProtocol || preset.imageProtocol || 'modelscope-proxy';
  next.backendUrl = next.backendUrl || 'http://127.0.0.1:8787';
  next.timeoutMs = next.provider === 'siliconflow'
    ? Math.max(Number(next.timeoutMs || 0), 120_000)
    : Math.max(Number(next.timeoutMs || 0), 300_000);
  const rootBaseUrl = 'https://api-inference.modelscope.cn';
  const v1BaseUrl = 'https://api-inference.modelscope.cn/v1';
  if (next.baseUrl.replace(/\/$/, '') === rootBaseUrl) {
    next.baseUrl = 'https://api-inference.modelscope.cn/v1';
    next.chatPath = next.chatPath.replace(/^\/v1/, '') || '/chat/completions';
    next.imagePath = next.imagePath.replace(/^\/v1/, '') || '/images/generations';
  }
  if (next.baseUrl.replace(/\/$/, '') === v1BaseUrl) {
    next.chatPath = (next.chatPath || '/chat/completions').replace(/^\/v1/, '') || '/chat/completions';
    next.imagePath = (next.imagePath || '/images/generations').replace(/^\/v1/, '') || '/images/generations';
    next.taskPath = (next.taskPath || '/tasks/{task_id}\n/tasks/{task_id}/result')
      .split(/\n|,/)
      .map((path) => path.trim().replace(/^\/v1/, ''))
      .filter(Boolean)
      .join('\n') || '/tasks/{task_id}\n/tasks/{task_id}/result';
  }
  const taskPathLines = new Set((next.taskPath || '').split(/\n|,/).map((path) => path.trim()).filter(Boolean));
  taskPathLines.add('/images/generations/{task_id}');
  taskPathLines.add('/images/generations/{task_id}/result');
  taskPathLines.add('/images/generations?task_id={task_id}');
  taskPathLines.add('/images/generations?request_id={request_id}');
  taskPathLines.add('/tasks/{task_id}');
  taskPathLines.add('/tasks/{task_id}/result');
  taskPathLines.add('https://api-inference.modelscope.cn/api/v1/images/generations/{task_id}');
  taskPathLines.add('https://api-inference.modelscope.cn/api/v1/images/generations/{task_id}/result');
  taskPathLines.add('https://api-inference.modelscope.cn/api/v1/tasks/{task_id}');
  taskPathLines.add('https://api-inference.modelscope.cn/api/v1/tasks/{task_id}/result');
  taskPathLines.add('https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}');
  taskPathLines.add('https://dashscope.aliyuncs.com/api/v1/tasks/{request_id}');
  next.taskPath = Array.from(taskPathLines).join('\n');
  return next;
}

export function Workspace() {
  const boot = useRef(loadInitialProject());
  const [projectId, setProjectId] = useState(boot.current.snapshot.id ?? createProjectId());
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>(boot.current.snapshot.settings);
  const [projects, setProjects] = useState<ProjectMeta[]>(boot.current.projects);
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>(boot.current.snapshot.nodes ? normalizeNodes(boot.current.snapshot.nodes) : initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowEdge>(boot.current.snapshot.edges ?? initialEdges);
  const [aiSettings, setAiSettingsState] = useState<ModelScopeSettings>(normalizeAiSettings({
    ...DEFAULT_MODELSCOPE_SETTINGS,
    ...(boot.current.snapshot.aiSettings ?? {}),
    ...(readJson<ModelScopeSettings>(AI_STORAGE_KEY) ?? {}),
  }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectManagerOpen, setProjectManagerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quickCreateMenu, setQuickCreateMenu] = useState<QuickCreateMenuState>();
  const [decomposeSourceId, setDecomposeSourceId] = useState<string>();
  const [decomposeKinds, setDecomposeKinds] = useState<NodeKind[]>(['palette', 'componentLibrary', 'background', 'ip', 'icon', 'typography']);
  const flowInstanceRef = useRef<ReactFlowInstance<any, WorkflowEdge> | null>(null);
  const connectStartRef = useRef<{ nodeId?: string | null; handleId?: string | null; handleType?: string | null }>({});
  const copiedNodesRef = useRef<WorkflowNode[]>([]);
  const nodeTypes = useMemo<NodeTypes>(() => ({ studio: StudioNode }), []);
  const selectedNode = nodes.find((node) => node.id === selectedId);

  const setAiSettings = useCallback((settings: ModelScopeSettings) => {
    const normalized = normalizeAiSettings(settings);
    setAiSettingsState(normalized);
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(normalized));
    setSaved(false);
  }, []);

  const updateNode = useCallback((id: string, patch: Partial<WorkflowNodeData>) => {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)));
    setSaved(false);
  }, [setNodes]);

  const renderedNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      id: node.id,
      onSetActiveImage: node.data.kind === 'images'
        ? (index: number) => updateNode(node.id, { activeImageIndex: index })
        : undefined,
    },
  })), [nodes, updateNode]);

  const clearSelection = useCallback(() => {
    setQuickCreateMenu(undefined);
    setSelectedId(undefined);
    setSelectedEdgeId(undefined);
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
  }, [setEdges]);

  const connect = useCallback((connection: Connection) => {
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    if (!source || !target || source.id === target.id) return;
    const id = `e-${source.id}-${target.id}-${crypto.randomUUID().slice(0, 6)}`;
    setEdges((current) => addEdge(decorateEdge({ ...connection, id }, nodes), current));
    setSaved(false);
  }, [nodes, setEdges]);

  const addNode = useCallback((kind: NodeKind) => {
    const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'studio',
        position: { x: 420 + Math.random() * 280, y: 160 + Math.random() * 240 },
        data: createNodeData(kind),
      },
    ]);
    setSelectedId(id);
    setSaved(false);
  }, [setNodes]);

  const addNodeAt = useCallback((kind: NodeKind, position: { x: number; y: number }) => {
    const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
    const node: WorkflowNode = {
      id,
      type: 'studio',
      position,
      data: createNodeData(kind),
    };
    setNodes((current) => [...current, node]);
    setSelectedId(id);
    setSelectedEdgeId(undefined);
    setSaved(false);
    return node;
  }, [setNodes]);

  const addImagesNodeAt = useCallback((images: AssetImage[], position: { x: number; y: number }, title = '参考图组') => {
    if (images.length === 0) return;
    const id = `images-${crypto.randomUUID().slice(0, 8)}`;
    const node: WorkflowNode = {
      id,
      type: 'studio',
      position,
      data: {
        ...createNodeData('images'),
        title,
        images,
        activeImageIndex: 0,
        message: `${images.length} 张参考图已导入`,
        status: 'success',
      },
    };
    setNodes((current) => [...current, node]);
    setSelectedId(id);
    setSelectedEdgeId(undefined);
    setSaved(false);
  }, [setNodes]);

  const addTextNodeAt = useCallback((text: string, position: { x: number; y: number }) => {
    const content = text.trim();
    if (!content) return;
    const id = `text-${crypto.randomUUID().slice(0, 8)}`;
    const node: WorkflowNode = {
      id,
      type: 'studio',
      position,
      data: {
        ...createNodeData('text'),
        text: content,
        title: content.length > 18 ? `${content.slice(0, 18)}…` : '文本需求',
        message: '已从剪贴板创建文本节点',
        status: 'success',
      },
    };
    setNodes((current) => [...current, node]);
    setSelectedId(id);
    setSelectedEdgeId(undefined);
    setSaved(false);
  }, [setNodes]);

  const pasteCopiedNodesAt = useCallback((position?: { x: number; y: number }) => {
    const copied = copiedNodesRef.current;
    if (copied.length === 0) return false;
    const minX = Math.min(...copied.map((node) => node.position.x));
    const minY = Math.min(...copied.map((node) => node.position.y));
    const offset = position ? { x: position.x - minX, y: position.y - minY } : { x: 42, y: 42 };
    const idMap = new Map<string, string>();
    const clones = copied.map((source) => {
      const id = `${source.data.kind}-${crypto.randomUUID().slice(0, 8)}`;
      idMap.set(source.id, id);
      return {
        ...source,
        id,
        selected: false,
        position: {
          x: source.position.x + offset.x,
          y: source.position.y + offset.y,
        },
        data: {
          ...source.data,
          title: `${source.data.title} 副本`,
          status: 'idle' as const,
          message: undefined,
          durationMs: undefined,
        },
      };
    });
    const cloneEdges = edges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge) => ({
        ...edge,
        id: `e-${idMap.get(edge.source)}-${idMap.get(edge.target)}-${crypto.randomUUID().slice(0, 6)}`,
        source: idMap.get(edge.source)!,
        target: idMap.get(edge.target)!,
        selected: false,
      }));
    const graphNodes = [...nodes, ...clones];
    setNodes((current) => [...current, ...clones]);
    setEdges((current) => [...current, ...cloneEdges.map((edge) => decorateEdge(edge, graphNodes))]);
    setSelectedId(clones[0]?.id);
    setSelectedEdgeId(undefined);
    setSaved(false);
    return true;
  }, [edges, nodes, setEdges, setNodes]);

  const addNodeAtConnectionEnd = useCallback((kind: NodeKind, menu: QuickCreateMenuState) => {
    const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
    const node: WorkflowNode = {
      id,
      type: 'studio',
      position: menu.position,
      data: createNodeData(kind),
    };
    const graphNodes = [...nodes, node];
    setNodes((current) => [...current, node]);
    setEdges((current) => addEdge(decorateEdge({
      id: `e-${menu.sourceId}-${id}-${crypto.randomUUID().slice(0, 6)}`,
      source: menu.sourceId,
      sourceHandle: menu.sourceHandle ?? undefined,
      target: id,
    }, graphNodes), current));
    setSelectedId(id);
    setSelectedEdgeId(undefined);
    setQuickCreateMenu(undefined);
    setSaved(false);
  }, [nodes, setEdges, setNodes]);

  const createDecompositionNodes = useCallback(() => {
    if (!decomposeSourceId || decomposeKinds.length === 0) return;
    const source = nodes.find((node) => node.id === decomposeSourceId);
    if (!source) return;

    const createdNodes: WorkflowNode[] = decomposeKinds.map((kind, index) => ({
      id: `${kind}-${crypto.randomUUID().slice(0, 8)}`,
      type: 'studio',
      position: {
        x: source.position.x + 330 + (index % 2) * 285,
        y: source.position.y - 90 + Math.floor(index / 2) * 190,
      },
      data: createNodeData(kind),
    }));
    const graphNodes = [...nodes, ...createdNodes];
    const createdEdges: WorkflowEdge[] = createdNodes.map((node) => decorateEdge({
      id: `e-${source.id}-${node.id}-${crypto.randomUUID().slice(0, 6)}`,
      source: source.id,
      target: node.id,
    }, graphNodes));

    setNodes((current) => [...current, ...createdNodes]);
    setEdges((current) => [...current, ...createdEdges]);
    setSelectedId(createdNodes[0]?.id);
    setSelectedEdgeId(undefined);
    setDecomposeSourceId(undefined);
    setSaved(false);
  }, [decomposeKinds, decomposeSourceId, nodes, setEdges, setNodes]);

  const duplicateNode = useCallback((id: string) => {
    const source = nodes.find((node) => node.id === id);
    if (!source) return;
    const newId = `${source.data.kind}-${crypto.randomUUID().slice(0, 8)}`;
    const clone: WorkflowNode = {
      ...source,
      id: newId,
      selected: false,
      position: { x: source.position.x + 42, y: source.position.y + 42 },
      data: {
        ...source.data,
        title: `${source.data.title} 副本`,
        status: 'idle',
        message: undefined,
        durationMs: undefined,
      },
    };
    setNodes((current) => [...current, clone]);
    setSelectedId(newId);
    setSelectedEdgeId(undefined);
    setSaved(false);
  }, [nodes, setNodes]);

  const resetNode = useCallback((id: string) => {
    updateNode(id, {
      status: 'idle',
      message: undefined,
      durationMs: undefined,
      stylePreview: undefined,
      screenImage: undefined,
      sheet: undefined,
      slices: undefined,
    });
  }, [updateNode]);

  const resetRunState = useCallback(() => {
    setNodes((current) => current.map((node) => ({
      ...node,
      data: {
        ...node.data,
        status: 'idle',
        message: undefined,
        durationMs: undefined,
      },
    })));
    setSaved(false);
  }, [setNodes]);

  const executeNode = useCallback(async (id: string) => {
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    updateNode(id, { status: 'running', message: '正在处理…' });
    const start = performance.now();
    try {
      const result = await runNode(node, nodes, edges, aiSettings);
      updateNode(id, {
        ...result,
        status: statusFromMessage(result.message),
        durationMs: Math.round(performance.now() - start),
      });
    } catch (error) {
      updateNode(id, { status: 'error', message: error instanceof Error ? error.message : '节点执行失败' });
    }
  }, [aiSettings, edges, nodes, updateNode]);

  const runAll = useCallback(async () => {
    setRunning(true);
    try {
      const order = getExecutionOrder(nodes, edges);
      let workingNodes = nodes;
      for (const node of order) {
        setNodes((current) => current.map((item) => (
          item.id === node.id ? { ...item, data: { ...item.data, status: 'running', message: '正在处理…' } } : item
        )));
        try {
          const currentNode = workingNodes.find((item) => item.id === node.id) ?? node;
          const result = await runNode(currentNode, workingNodes, edges, aiSettings);
          workingNodes = workingNodes.map((item) => (
            item.id === node.id
              ? { ...item, data: { ...item.data, ...result, status: statusFromMessage(result.message) } }
              : item
          ));
          setNodes(workingNodes);
        } catch (error) {
          workingNodes = workingNodes.map((item) => (
            item.id === node.id
              ? { ...item, data: { ...item.data, status: 'error', message: error instanceof Error ? error.message : '执行失败' } }
              : item
          ));
          setNodes(workingNodes);
          break;
        }
      }
    } finally {
      setRunning(false);
      setSaved(false);
    }
  }, [aiSettings, edges, nodes, setNodes]);

  const makeSnapshot = useCallback((override?: Partial<ProjectSnapshot>): ProjectSnapshot => ({
    version: 1,
    id: projectId,
    settings: projectSettings,
    aiSettings,
    nodes,
    edges,
    savedAt: new Date().toISOString(),
    ...override,
  }), [aiSettings, edges, nodes, projectId, projectSettings]);

  const saveToLocal = useCallback(() => {
    setSaving(true);
    const result = saveProjectSnapshot(makeSnapshot(), projects);
    setProjectId(result.snapshot.id ?? projectId);
    setProjects(result.projects);
    setSaved(true);
    window.setTimeout(() => setSaving(false), 260);
  }, [makeSnapshot, projectId, projects]);

  useEffect(() => {
    if (saved || running) return undefined;
    setSaving(false);
    const timer = window.setTimeout(() => {
      saveToLocal();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [running, saveToLocal, saved]);

  const exportProjectJson = useCallback(() => {
    const snapshot: ProjectSnapshot = {
      version: 1,
      id: projectId,
      settings: projectSettings,
      aiSettings,
      nodes,
      edges,
      savedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(projectSettings.name || 'styleslice-project').replace(/[\\/:*?"<>|]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [aiSettings, edges, nodes, projectId, projectSettings]);

  const renameProject = useCallback((name: string) => {
    const nextName = name || '未命名 UI Kit';
    setProjectSettings((current) => ({ ...current, name }));
    setProjects((current) => current.map((project) => (
      project.id === projectId ? { ...project, name: nextName } : project
    )));
    setSaved(false);
  }, [projectId]);

  const loadProject = useCallback((id: string) => {
    const snapshot = loadProjectSnapshot(id);
    if (!snapshot) return;
    setProjectId(snapshot.id ?? id);
    setProjectSettings(snapshot.settings);
    setNodes(normalizeNodes(snapshot.nodes ?? initialNodes));
    setEdges(snapshot.edges ?? initialEdges);
    setAiSettingsState(normalizeAiSettings({
      ...DEFAULT_MODELSCOPE_SETTINGS,
      ...(snapshot.aiSettings ?? {}),
      ...(readJson<ModelScopeSettings>(AI_STORAGE_KEY) ?? {}),
    }));
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    setSelectedId(undefined);
    setSelectedEdgeId(undefined);
    setProjectManagerOpen(false);
    setSaved(true);
  }, [setEdges, setNodes]);

  const createNewProject = useCallback(() => {
    const snapshot = createProjectSnapshot(`新项目 ${projects.length + 1}`, aiSettings);
    const result = saveProjectSnapshot(snapshot, projects);
    setProjectId(result.snapshot.id ?? snapshot.id ?? createProjectId());
    setProjectSettings(result.snapshot.settings);
    setProjects(result.projects);
    setNodes(normalizeNodes(result.snapshot.nodes));
    setEdges(result.snapshot.edges);
    setSelectedId(undefined);
    setSelectedEdgeId(undefined);
    setSaved(true);
  }, [aiSettings, projects, setEdges, setNodes]);

  const duplicateProject = useCallback((id: string) => {
    const snapshot = loadProjectSnapshot(id);
    if (!snapshot) return;
    const copy: ProjectSnapshot = {
      ...snapshot,
      id: createProjectId(),
      settings: {
        ...snapshot.settings,
        name: `${snapshot.settings.name || '未命名 UI Kit'} 副本`,
      },
      savedAt: new Date().toISOString(),
    };
    const result = saveProjectSnapshot(copy, projects);
    setProjects(result.projects);
  }, [projects]);

  const deleteProject = useCallback((id: string) => {
    if (projects.length <= 1) return;
    localStorage.removeItem(projectStorageKey(id));
    const nextProjects = projects.filter((project) => project.id !== id);
    writeProjectIndex(nextProjects);
    setProjects(nextProjects);
    if (id === projectId) {
      loadProject(nextProjects[0].id);
    }
  }, [loadProject, projectId, projects]);

  const autoLayout = useCallback(() => {
    const grouped = new Map<number, WorkflowNode[]>();
    nodes.forEach((node) => {
      const column = LAYOUT_COLUMNS[node.data.kind] ?? 0;
      grouped.set(column, [...(grouped.get(column) ?? []), node]);
    });
    const positionById = new Map<string, { x: number; y: number }>();
    grouped.forEach((group, column) => {
      const sorted = [...group].sort((a, b) => {
        if (a.data.kind === 'text' && b.data.kind === 'images') return -1;
        if (a.data.kind === 'images' && b.data.kind === 'text') return 1;
        return a.position.y - b.position.y || a.position.x - b.position.x;
      });
      const totalHeight = (sorted.length - 1) * LAYOUT_ROW_GAP;
      sorted.forEach((node, index) => {
        positionById.set(node.id, {
          x: LAYOUT_BASE_X + column * LAYOUT_COLUMN_GAP,
          y: LAYOUT_BASE_Y - totalHeight / 2 + index * LAYOUT_ROW_GAP,
        });
      });
    });
    setNodes((current) => current.map((node) => {
      const position = positionById.get(node.id) ?? node.position;
      return {
        ...node,
        position,
      };
    }));
    setSaved(false);
  }, [nodes, setNodes]);

  const exportAssets = useCallback(async () => {
    const slices = nodes.flatMap((node) => node.data.slices ?? []);
    if (slices.length === 0) return;
    const zip = new JSZip();
    const spriteFolder = zip.folder('sprites');
    slices.forEach((slice) => spriteFolder?.file(slice.name, dataUrlToBlob(slice.dataUrl)));
    zip.file('sprites.json', JSON.stringify(slices.map(({ dataUrl: _, ...slice }) => slice), null, 2));
    zip.file('README_IMPORT_UNITY.md', [
      '# StyleSlice Unity 导入',
      '',
      '1. 将 sprites 文件夹拖入 Assets。',
      '2. Texture Type 设为 Sprite (2D and UI)。',
      '3. 对面板类资源使用 sprites.json 中的 suggestedBorder 配置九宫格。',
      '',
    ].join('\n'));
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'styleslice-unity-kit.zip';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [nodes]);

  const removeNode = useCallback((id: string) => {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedId(undefined);
    setSaved(false);
  }, [setEdges, setNodes]);

  const removeEdge = useCallback((id: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== id));
    setSelectedEdgeId(undefined);
    setSaved(false);
  }, [setEdges]);

  const removeSelection = useCallback(() => {
    if (selectedId) {
      removeNode(selectedId);
      return;
    }
    if (selectedEdgeId) {
      removeEdge(selectedEdgeId);
    }
  }, [removeEdge, removeNode, selectedEdgeId, selectedId]);

  const handleEdgeClick = useCallback<EdgeMouseHandler<WorkflowEdge>>((event, edge) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      removeEdge(edge.id);
      return;
    }
    setSelectedId(undefined);
    setSelectedEdgeId(edge.id);
    setEdges((current) => current.map((item) => ({ ...item, selected: item.id === edge.id })));
  }, [removeEdge, setEdges]);

  const handleConnectStart = useCallback((_: MouseEvent | TouchEvent, params: { nodeId?: string | null; handleId?: string | null; handleType?: string | null }) => {
    connectStartRef.current = params;
    setQuickCreateMenu(undefined);
  }, []);

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState?: { isValid?: boolean | null }) => {
    const start = connectStartRef.current;
    connectStartRef.current = {};
    if (!start.nodeId || start.handleType === 'target' || connectionState?.isValid) return;

    const flow = flowInstanceRef.current;
    const canvas = document.querySelector('.canvas-shell');
    if (!flow || !(canvas instanceof HTMLElement)) return;

    const point = pointerFromConnectEvent(event);
    const canvasRect = canvas.getBoundingClientRect();
    const screen = {
      x: Math.min(Math.max(point.x - canvasRect.left, 12), canvasRect.width - 260),
      y: Math.min(Math.max(point.y - canvasRect.top, 48), canvasRect.height - 260),
    };
    const position = flow.screenToFlowPosition({ x: point.x, y: point.y });
    setQuickCreateMenu({
      sourceId: start.nodeId,
      sourceHandle: start.handleId,
      screen,
      position,
    });
  }, []);

  const flowPositionFromClient = useCallback((clientX: number, clientY: number) => (
    flowInstanceRef.current?.screenToFlowPosition({ x: clientX, y: clientY }) ?? { x: clientX, y: clientY }
  ), []);

  const centerFlowPosition = useCallback(() => {
    const canvas = document.querySelector('.canvas-shell');
    if (canvas instanceof HTMLElement) {
      const rect = canvas.getBoundingClientRect();
      return flowPositionFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    return { x: 420, y: 220 };
  }, [flowPositionFromClient]);

  const targetImagesNodeFromEvent = useCallback((event: DragEvent | ReactDragEvent | ClipboardEvent) => {
    const target = event.target as HTMLElement | null;
    const nodeElement = target?.closest('[data-node-id]');
    const nodeId = nodeElement instanceof HTMLElement ? nodeElement.dataset.nodeId : undefined;
    const node = nodeId ? nodes.find((item) => item.id === nodeId) : undefined;
    return node?.data.kind === 'images' ? node : undefined;
  }, [nodes]);

  const mergeImagesIntoNode = useCallback((targetId: string, images: AssetImage[]) => {
    if (images.length === 0) return;
    setNodes((current) => current.map((node) => {
      if (node.id !== targetId || node.data.kind !== 'images') return node;
      const existing = node.data.images ?? [];
      return {
        ...node,
        data: {
          ...node.data,
          images: [...existing, ...images],
          activeImageIndex: existing.length,
          status: 'success',
          message: `${existing.length + images.length} 张参考图已组合`,
        },
      };
    }));
    setSelectedId(targetId);
    setSaved(false);
  }, [setNodes]);

  const moveImageFromNode = useCallback((sourceNodeId: string, imageId: string, targetNodeId: string | undefined, position: { x: number; y: number }) => {
    const source = nodes.find((node) => node.id === sourceNodeId);
    const image = source?.data.images?.find((item) => item.id === imageId);
    if (!source || !image) return;
    if (targetNodeId && targetNodeId === sourceNodeId) return;

    setNodes((current) => {
      let next = current.map((node) => {
        if (node.id !== sourceNodeId || node.data.kind !== 'images') return node;
        const nextImages = (node.data.images ?? []).filter((item) => item.id !== imageId);
        return {
          ...node,
          data: {
            ...node.data,
            images: nextImages,
            activeImageIndex: Math.min(node.data.activeImageIndex ?? 0, Math.max(nextImages.length - 1, 0)),
            status: nextImages.length ? node.data.status : 'idle',
            message: nextImages.length ? `${nextImages.length} 张参考图已就绪` : '参考图已移出',
          },
        };
      });
      if (targetNodeId) {
        next = next.map((node) => {
          if (node.id !== targetNodeId || node.data.kind !== 'images') return node;
          const existing = node.data.images ?? [];
          return {
            ...node,
            data: {
              ...node.data,
              images: [...existing, image],
              activeImageIndex: existing.length,
              status: 'success',
              message: `${existing.length + 1} 张参考图已组合`,
            },
          };
        });
      } else {
        const id = `images-${crypto.randomUUID().slice(0, 8)}`;
        next = [
          ...next,
          {
            id,
            type: 'studio',
            position,
            data: {
              ...createNodeData('images'),
              title: image.name.replace(/\.[^.]+$/, '') || '拆分参考图',
              images: [image],
              activeImageIndex: 0,
              status: 'success',
              message: '已从参考图组拆分为独立节点',
            },
          },
        ];
        setSelectedId(id);
      }
      return next;
    });
    if (targetNodeId) setSelectedId(targetNodeId);
    setSaved(false);
  }, [nodes, setNodes]);

  const handleCanvasDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const hasFiles = Array.from(event.dataTransfer.items ?? []).some((item) => item.kind === 'file');
    const hasInternalImage = Boolean(event.dataTransfer.types.includes('application/x-styleslice-image'));
    const hasPaletteNode = Boolean(event.dataTransfer.types.includes(NODE_PALETTE_DRAG_TYPE));
    if (hasFiles || hasInternalImage || hasPaletteNode) {
      event.preventDefault();
      event.dataTransfer.dropEffect = hasInternalImage ? 'move' : 'copy';
    }
  }, []);

  const handleCanvasDrop = useCallback(async (event: ReactDragEvent<HTMLElement>) => {
    const position = flowPositionFromClient(event.clientX, event.clientY);
    const targetImagesNode = targetImagesNodeFromEvent(event);
    const paletteNodeKind = event.dataTransfer.getData(NODE_PALETTE_DRAG_TYPE) as NodeKind;
    if (paletteNodeKind && NODE_REGISTRY[paletteNodeKind]) {
      event.preventDefault();
      addNodeAt(paletteNodeKind, position);
      return;
    }

    const internalPayload = event.dataTransfer.getData('application/x-styleslice-image');
    if (internalPayload) {
      event.preventDefault();
      try {
        const payload = JSON.parse(internalPayload) as DraggedImagePayload;
        if (payload.sourceNodeId && payload.imageId) {
          moveImageFromNode(payload.sourceNodeId, payload.imageId, targetImagesNode?.id, position);
        }
      } catch {
        // ignore malformed drag payload
      }
      return;
    }

    const files = Array.from(event.dataTransfer.files ?? []).filter(isImageFile);
    if (files.length === 0) return;
    event.preventDefault();
    const images = await filesToAssetImages(files);
    if (targetImagesNode) mergeImagesIntoNode(targetImagesNode.id, images);
    else addImagesNodeAt(images, position, images.length > 1 ? '拖入参考图组' : images[0]?.name.replace(/\.[^.]+$/, '') || '拖入参考图');
  }, [addImagesNodeAt, addNodeAt, flowPositionFromClient, mergeImagesIntoNode, moveImageFromNode, targetImagesNodeFromEvent]);

  const handleNodeDragStart = useCallback<OnNodeDrag<WorkflowNode>>((event, node) => {
    if (!event.altKey) return;
    const newId = `${node.data.kind}-${crypto.randomUUID().slice(0, 8)}`;
    const clone: WorkflowNode = {
      ...node,
      id: newId,
      selected: false,
      position: { x: node.position.x + 38, y: node.position.y + 38 },
      data: {
        ...node.data,
        title: `${node.data.title} 副本`,
        status: 'idle',
        message: undefined,
        durationMs: undefined,
      },
    };
    setNodes((current) => [...current, clone]);
    setSelectedId(newId);
    setSelectedEdgeId(undefined);
    setSaved(false);
  }, [setNodes]);

  useEffect(() => {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(aiSettings));
  }, [aiSettings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault();
        saveToLocal();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'c' && selectedId) {
        event.preventDefault();
        const selected = nodes.find((node) => node.id === selectedId);
        copiedNodesRef.current = selected ? [selected] : [];
        void navigator.clipboard?.writeText(`${NODE_CLIPBOARD_PREFIX}${selectedId}`).catch(() => undefined);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'd' && selectedId) {
        event.preventDefault();
        duplicateNode(selectedId);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'l') {
        event.preventDefault();
        autoLayout();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (selectedId) void executeNode(selectedId);
        else void runAll();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [autoLayout, duplicateNode, executeNode, nodes, removeSelection, runAll, saveToLocal, selectedId]);

  useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const position = centerFlowPosition();
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (text.startsWith(NODE_CLIPBOARD_PREFIX) && copiedNodesRef.current.length > 0) {
        event.preventDefault();
        pasteCopiedNodesAt(position);
        return;
      }
      const files = Array.from(event.clipboardData?.files ?? []).filter(isImageFile);
      if (files.length > 0) {
        event.preventDefault();
        const images = await filesToAssetImages(files);
        addImagesNodeAt(images, position, images.length > 1 ? '粘贴参考图组' : '粘贴参考图');
        return;
      }
      if (text.trim()) {
        event.preventDefault();
        addTextNodeAt(text, position);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImagesNodeAt, addTextNodeAt, centerFlowPosition, pasteCopiedNodesAt]);

  return (
    <div className="app-shell">
      <TopBar
        projectName={projectSettings.name}
        saved={saved}
        saving={saving}
        running={running}
        aiEnabled={aiSettings.enabled}
        onProjectNameChange={renameProject}
        onNewProject={createNewProject}
        onManageProjects={() => setProjectManagerOpen(true)}
        onRunAll={runAll}
        onSaveProject={saveToLocal}
        onExportProject={exportProjectJson}
        onOpenAiSettings={() => setSettingsOpen(true)}
        onAutoLayout={autoLayout}
        onResetRunState={resetRunState}
      />
      <div className="workspace-grid">
        <NodePalette />
        <main className="canvas-shell" onDragOver={handleCanvasDragOver} onDrop={handleCanvasDrop}>
          <div className="canvas-label"><span>WORKFLOW /</span> 资产生成主流程</div>
          <div className="shortcut-hints" aria-label="快捷键提示">
            <span>Del 删除</span>
            <span>Ctrl+单击连线断开</span>
            <span>Ctrl+D 复制</span>
            <span>Ctrl+L 整理</span>
            <span>Ctrl+Enter 运行</span>
          </div>
          <ReactFlow
            nodes={renderedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              flowInstanceRef.current = instance;
            }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connect}
            onConnectStart={handleConnectStart}
            onConnectEnd={handleConnectEnd}
            onEdgeClick={handleEdgeClick}
            onNodeClick={(_, node) => {
              setQuickCreateMenu(undefined);
              setSelectedId(node.id);
              setSelectedEdgeId(undefined);
              setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
            }}
            onNodeDragStart={handleNodeDragStart}
            onPaneClick={clearSelection}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            minZoom={0.35}
            maxZoom={1.6}
            selectionOnDrag
            panOnDrag={[1, 2]}
            selectNodesOnDrag={false}
            colorMode="dark"
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="#333844" />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor={(node) => NODE_REGISTRY[(node.data as WorkflowNodeData).kind].color}
            />
          </ReactFlow>
          {quickCreateMenu && (
            <div
              className="quick-create-menu"
              style={{ left: quickCreateMenu.screen.x, top: quickCreateMenu.screen.y }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="quick-create-title">
                <span>从连线创建节点</span>
                <button type="button" onClick={() => setQuickCreateMenu(undefined)} aria-label="关闭快捷创建">×</button>
              </div>
              <div className="quick-create-grid">
                {NODE_ORDER.map((kind) => {
                  const definition = NODE_REGISTRY[kind];
                  const Icon = definition.icon;
                  const source = nodes.find((node) => node.id === quickCreateMenu.sourceId);
                  const recommended = isRecommendedConnection(source, { id: '__preview__', type: 'studio', position: quickCreateMenu.position, data: createNodeData(kind) } as WorkflowNode);
                  return (
                    <button
                      key={kind}
                      type="button"
                      className={recommended ? 'is-recommended' : undefined}
                      onClick={() => addNodeAtConnectionEnd(kind, quickCreateMenu)}
                    >
                      <span className="quick-create-icon" style={{ color: definition.color }}><Icon size={14} /></span>
                      <span>
                        <strong>{definition.label}</strong>
                        <small>{recommended ? '推荐连接' : '自由连接'}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </main>
        <Inspector
          node={selectedNode}
          selectedEdge={edges.find((edge) => edge.id === selectedEdgeId)}
          onChange={updateNode}
          onRun={executeNode}
          onDelete={removeNode}
          onDeleteEdge={removeEdge}
          onReset={resetNode}
          onDuplicate={duplicateNode}
          onDecomposeImages={(id) => {
            setDecomposeSourceId(id);
            setDecomposeKinds(['palette', 'componentLibrary', 'background', 'ip', 'icon', 'typography']);
          }}
          onExport={exportAssets}
        />
      </div>
      <StatusBar
        nodeCount={nodes.length}
        edgeCount={edges.length}
        successCount={nodes.filter((node) => node.data.status === 'success' || node.data.status === 'warning').length}
        aiEnabled={aiSettings.enabled}
      />
      <AiSettingsPanel open={settingsOpen} settings={aiSettings} onChange={setAiSettings} onClose={() => setSettingsOpen(false)} />
      {decomposeSourceId && (
        <div className="settings-backdrop" role="presentation">
          <section className="decompose-panel" role="dialog" aria-modal="true" aria-labelledby="decompose-title">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">DECOMPOSE</span>
                <h2 id="decompose-title">拆解参考图</h2>
              </div>
              <button className="icon-button" onClick={() => setDecomposeSourceId(undefined)} aria-label="关闭拆解面板">×</button>
            </div>
            <p className="settings-note">
              选择要从参考图衍生出的分析节点。当前色板为本地真实提取；组件库、底图、IP、Icon、字体节点先生成结构化拆解入口，后续可继续接 CV/OCR/AI。
            </p>
            <div className="decompose-grid">
              {DECOMPOSITION_KINDS.map((kind) => {
                const definition = NODE_REGISTRY[kind];
                const Icon = definition.icon;
                const checked = decomposeKinds.includes(kind);
                return (
                  <label key={kind} className={`decompose-option ${checked ? 'active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => setDecomposeKinds((current) => (
                        event.target.checked
                          ? Array.from(new Set([...current, kind]))
                          : current.filter((item) => item !== kind)
                      ))}
                    />
                    <span className="palette-icon" style={{ color: definition.color }}><Icon size={17} /></span>
                    <span>
                      <strong>{definition.label}</strong>
                      <small>{definition.description}</small>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="settings-test-row">
              <button className="primary-button" onClick={createDecompositionNodes} disabled={decomposeKinds.length === 0}>生成拆解节点</button>
              <button className="secondary-button" onClick={() => setDecomposeSourceId(undefined)}>取消</button>
            </div>
          </section>
        </div>
      )}
      {projectManagerOpen && (
        <div className="settings-backdrop" role="presentation">
          <section className="settings-panel project-manager" role="dialog" aria-modal="true" aria-labelledby="project-manager-title">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">PROJECTS</span>
                <h2 id="project-manager-title">项目管理</h2>
              </div>
              <button className="icon-button" onClick={() => setProjectManagerOpen(false)} aria-label="关闭项目管理">×</button>
            </div>
            <div className="project-manager-actions">
              <button className="primary-button" onClick={createNewProject}>新建项目</button>
              <button className="secondary-button" onClick={saveToLocal}>保存当前项目</button>
            </div>
            <div className="project-list">
              {projects.map((project) => (
                <article className={`project-card ${project.id === projectId ? 'active' : ''}`} key={project.id}>
                  <div>
                    <strong>{project.name || '未命名 UI Kit'}</strong>
                    <small>{new Date(project.updatedAt).toLocaleString()}</small>
                  </div>
                  <div className="project-card-actions">
                    <button className="secondary-button compact-button" onClick={() => loadProject(project.id)} disabled={project.id === projectId}>打开</button>
                    <button className="secondary-button compact-button" onClick={() => duplicateProject(project.id)}>复制</button>
                    <button className="secondary-button compact-button danger-text" onClick={() => deleteProject(project.id)} disabled={projects.length <= 1}>删除</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
