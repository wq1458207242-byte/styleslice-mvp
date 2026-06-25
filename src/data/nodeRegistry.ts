import { Brackets, FileArchive, ImagePlus, Layers3, Palette, Type, LayoutTemplate, Image, Sparkles, Smile, CaseSensitive } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NodeKind, WorkflowNodeData } from '../types/workflow';

export interface NodeDefinition {
  kind: NodeKind;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  color: string;
  accepts: NodeKind[];
  defaults: Partial<WorkflowNodeData>;
}

export const NODE_REGISTRY: Record<NodeKind, NodeDefinition> = {
  text: {
    kind: 'text',
    label: '文本需求',
    shortLabel: '文本',
    icon: Type,
    color: '#8b8ef8',
    description: '描述游戏、组件和生成约束',
    accepts: [],
    defaults: { text: '奇幻 RPG 设置菜单，庄重、古旧、适合宽屏游戏界面。' },
  },
  images: {
    kind: 'images',
    label: '参考图组',
    shortLabel: '图像',
    icon: ImagePlus,
    color: '#52b7a5',
    description: '上传 3–5 张意向图，作为风格证据',
    accepts: [],
    defaults: { images: [] },
  },
  palette: {
    kind: 'palette',
    label: '色板节点',
    shortLabel: '色板',
    icon: Palette,
    color: '#f3b45f',
    description: '从参考图本地提取主色、辅助色与强调色',
    accepts: ['images'],
    defaults: { analysisItems: [] },
  },
  componentLibrary: {
    kind: 'componentLibrary',
    label: '组件库节点',
    shortLabel: '组件库',
    icon: LayoutTemplate,
    color: '#d8789f',
    description: '拆解参考图中的导航、卡片、按钮、徽章等 UI 组件候选',
    accepts: ['images', 'palette'],
    defaults: { analysisItems: [] },
  },
  background: {
    kind: 'background',
    label: '底图节点',
    shortLabel: '底图',
    icon: Image,
    color: '#85c7dd',
    description: '分析背景层、纹理、渐变与可复用底图方向',
    accepts: ['images', 'palette'],
    defaults: { analysisItems: [] },
  },
  ip: {
    kind: 'ip',
    label: 'IP节点',
    shortLabel: 'IP',
    icon: Smile,
    color: '#f08ea4',
    description: '拆解角色/IP/吉祥物造型语言与后续资产方向',
    accepts: ['images'],
    defaults: { analysisItems: [] },
  },
  icon: {
    kind: 'icon',
    label: 'Icon节点',
    shortLabel: 'Icon',
    icon: Sparkles,
    color: '#ffd84d',
    description: '提取图标、装饰符号与小型视觉元素规则',
    accepts: ['images', 'palette'],
    defaults: { analysisItems: [] },
  },
  typography: {
    kind: 'typography',
    label: '字体节点',
    shortLabel: '字体',
    icon: CaseSensitive,
    color: '#cda7ff',
    description: '分析文字层级、字重、描边与字体识别建议',
    accepts: ['images'],
    defaults: { analysisItems: [] },
  },
  style: {
    kind: 'style',
    label: '设计风格包',
    shortLabel: '风格',
    icon: Palette,
    color: '#e2a955',
    description: '提取色彩、材质、形状与提示词',
    accepts: ['text', 'images'],
    defaults: {},
  },
  components: {
    kind: 'components',
    label: '原子组件板',
    shortLabel: '组件',
    icon: Layers3,
    color: '#d8789f',
    description: '按模板批量生成可复用 UI 组件',
    accepts: ['text', 'style', 'palette', 'componentLibrary'],
    defaults: { componentTypes: ['按钮', '面板', '徽章', '进度条', '对话框', '头像框'] },
  },
  slice: {
    kind: 'slice',
    label: '切片与质检',
    shortLabel: '切片',
    icon: Brackets,
    color: '#69a6e8',
    description: '透明化、裁边、命名与九宫格建议',
    accepts: ['components', 'componentLibrary', 'background', 'ip', 'icon', 'typography'],
    defaults: { slices: [] },
  },
  export: {
    kind: 'export',
    label: 'Unity 导出',
    shortLabel: '导出',
    icon: FileArchive,
    color: '#88b35c',
    description: '打包 PNG、元数据与导入说明',
    accepts: ['slice'],
    defaults: {},
  },
};

export const NODE_ORDER: NodeKind[] = ['text', 'images', 'palette', 'componentLibrary', 'background', 'ip', 'icon', 'typography', 'style', 'components', 'slice', 'export'];

export function createNodeData(kind: NodeKind): WorkflowNodeData {
  const definition = NODE_REGISTRY[kind];
  return {
    kind,
    title: definition.label,
    description: definition.description,
    status: 'idle',
    ...definition.defaults,
  };
}
