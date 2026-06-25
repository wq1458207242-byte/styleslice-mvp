import type { Edge, Node } from '@xyflow/react';

export type NodeKind =
  | 'text'
  | 'images'
  | 'style'
  | 'screen'
  | 'components'
  | 'slice'
  | 'export'
  | 'palette'
  | 'componentLibrary'
  | 'background'
  | 'ip'
  | 'icon'
  | 'typography';
export type RunStatus = 'idle' | 'queued' | 'running' | 'success' | 'warning' | 'error';

export interface AssetImage {
  id: string;
  name: string;
  dataUrl: string;
  width?: number;
  height?: number;
}

export interface StylePack {
  name: string;
  description: string;
  palette: string[];
  material: string;
  shape: string;
  decoration: string;
  prompt: string;
  negativePrompt: string;
  consistency: number;
  visualEvidence?: string[];
  visionStatus?: 'seen' | 'not_seen' | 'text_only';
  rawModelSummary?: string;
  source?: 'local' | 'modelscope';
}

export interface SliceAsset extends AssetImage {
  category: string;
  state: string;
  suggestedBorder: [number, number, number, number];
}

export interface AssetClassification {
  index: number;
  keep: boolean;
  category: string;
  name: string;
  componentType?: string;
  confidence: number;
  notes?: string;
}

export interface GenerationQualityReport {
  ok: boolean;
  score: number;
  issues: string[];
  suggestions: string[];
  provider?: string;
  model?: string;
  promptSummary?: string;
}

export interface ComponentSpec {
  id: string;
  label: string;
  category: string;
  enabled: boolean;
  count: number;
  promptHint?: string;
}

export interface AiTestResult {
  id: 'proxy' | 'text' | 'vision' | 'image';
  label: string;
  status: 'idle' | 'running' | 'success' | 'warning' | 'error';
  message: string;
  durationMs?: number;
}

export interface WorkflowNodeData extends Record<string, unknown> {
  kind: NodeKind;
  title: string;
  description: string;
  status: RunStatus;
  text?: string;
  images?: AssetImage[];
  activeImageIndex?: number;
  stylePack?: StylePack;
  stylePreview?: AssetImage;
  screenImage?: AssetImage;
  componentTypes?: string[];
  componentPlan?: ComponentSpec[];
  sheet?: AssetImage;
  slices?: SliceAsset[];
  analysisItems?: string[];
  extractedAssets?: AssetImage[];
  classifications?: AssetClassification[];
  qualityReport?: GenerationQualityReport;
  message?: string;
  durationMs?: number;
}

export type WorkflowNode = Node<WorkflowNodeData, 'studio'>;
export type WorkflowEdge = Edge;

export interface ModelScopeSettings {
  enabled: boolean;
  provider: 'modelscope' | 'siliconflow';
  apiKey: string;
  providerKeys?: Partial<Record<'modelscope' | 'siliconflow', string>>;
  baseUrl: string;
  chatModel: string;
  visionModel: string;
  imageModel: string;
  chatPath: string;
  imagePath: string;
  taskPath: string;
  imageProtocol: 'openai' | 'modelscope-async' | 'modelscope-proxy' | 'dashscope-async' | 'siliconflow';
  backendUrl: string;
  timeoutMs: number;
}

export interface ProjectSettings {
  name: string;
  engine: 'Unity';
  resolution: '1920 × 1080' | '2560 × 1440' | '1080 × 1920';
  pixelArt: boolean;
}

export interface ProjectSnapshot {
  version: 1;
  id?: string;
  settings: ProjectSettings;
  aiSettings?: ModelScopeSettings;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  savedAt: string;
}
