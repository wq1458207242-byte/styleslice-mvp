import type { ComponentSpec } from '../types/workflow';

export const COMPONENT_CATEGORIES = [
  {
    id: 'controls',
    label: '基础控件',
    description: '最常用、最适合批量出变体的交互元素',
    items: [
      { id: 'button', label: '按钮', promptHint: 'empty rounded action button, pressable bevel, no text' },
      { id: 'tab', label: '标签页', promptHint: 'empty tab selector, active and inactive frame language, no text' },
      { id: 'switch', label: '开关', promptHint: 'toggle switch control, clean state indicator, no icon text' },
      { id: 'slider', label: '滑杆', promptHint: 'horizontal slider track with knob, no numbers' },
    ],
  },
  {
    id: 'containers',
    label: '容器与面板',
    description: '适合 Unity 九宫格切片、承载内容的框体',
    items: [
      { id: 'panel', label: '面板', promptHint: 'empty reusable content panel, sliced-friendly frame, no inner content' },
      { id: 'dialog', label: '对话框', promptHint: 'empty dialog box frame, title band allowed, no readable letters' },
      { id: 'card', label: '任务卡片', promptHint: 'empty quest/card container, decorative corners, no text' },
      { id: 'banner', label: '横幅条', promptHint: 'wide banner ribbon or header strip, no text' },
    ],
  },
  {
    id: 'feedback',
    label: '状态反馈',
    description: '进度、徽章、提示等强调状态的组件',
    items: [
      { id: 'badge', label: '徽章', promptHint: 'small medal or badge frame, abstract symbol only, no mascot face' },
      { id: 'progress', label: '进度条', promptHint: 'progress bar frame with fill track, no text or numbers' },
      { id: 'toast', label: '轻提示', promptHint: 'small toast notification container, no words' },
      { id: 'reward', label: '奖励框', promptHint: 'empty reward slot frame, sparkle accents, no item inside' },
    ],
  },
  {
    id: 'identity',
    label: '身份与资源',
    description: '头像、资源图标、入口类资产',
    items: [
      { id: 'avatar', label: '头像框', promptHint: 'empty avatar frame, no portrait, no face, no character inside' },
      { id: 'resourceIcon', label: '资源图标', promptHint: 'simple resource icon, same UI material, no mascot' },
      { id: 'quickEntry', label: '快速入口', promptHint: 'small square menu entry tile, icon placeholder only, no text' },
      { id: 'coupon', label: '票券', promptHint: 'empty ticket or coupon UI asset, perforated edges, no text' },
    ],
  },
] as const;

export const DEFAULT_COMPONENT_PLAN: ComponentSpec[] = COMPONENT_CATEGORIES.flatMap((category) =>
  category.items.map((item, index) => ({
    id: item.id,
    label: item.label,
    category: category.label,
    enabled: ['button', 'panel', 'badge', 'progress', 'dialog', 'avatar'].includes(item.id),
    count: ['button', 'panel'].includes(item.id) ? 2 : 1,
    promptHint: item.promptHint,
  })),
);

export function normalizeComponentPlan(plan?: ComponentSpec[], legacyTypes?: string[]) {
  const byLabel = new Map((plan ?? []).map((item) => [item.label, item]));
  const legacySet = new Set(legacyTypes ?? []);
  return DEFAULT_COMPONENT_PLAN.map((base) => {
    const saved = byLabel.get(base.label);
    if (saved) {
      return {
        ...base,
        ...saved,
        count: Math.max(1, Math.min(8, Math.round(Number(saved.count) || 1))),
      };
    }
    if (legacySet.has(base.label)) return { ...base, enabled: true, count: base.count || 1 };
    return { ...base };
  });
}

export function selectedComponentSpecs(plan?: ComponentSpec[], legacyTypes?: string[]) {
  return normalizeComponentPlan(plan, legacyTypes).filter((item) => item.enabled && item.count > 0);
}

export function expandComponentSpecs(plan?: ComponentSpec[], legacyTypes?: string[]) {
  return selectedComponentSpecs(plan, legacyTypes).flatMap((item) =>
    Array.from({ length: item.count }, (_, index) => ({
      ...item,
      instanceIndex: index + 1,
      total: item.count,
      instanceLabel: item.count > 1 ? `${item.label}${index + 1}` : item.label,
    })),
  );
}

export function componentTypesFromPlan(plan?: ComponentSpec[], legacyTypes?: string[]) {
  return expandComponentSpecs(plan, legacyTypes).map((item) => item.instanceLabel);
}

