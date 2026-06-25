import { Copy, Download, GitBranch, ImagePlus, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ChangeEvent, MouseEvent } from 'react';
import { COMPONENT_CATEGORIES, componentTypesFromPlan, normalizeComponentPlan, selectedComponentSpecs } from '../data/componentCatalog';
import type { ComponentSpec, WorkflowEdge, WorkflowNode, WorkflowNodeData } from '../types/workflow';

interface InspectorProps {
  node?: WorkflowNode;
  selectedEdge?: WorkflowEdge;
  onChange: (id: string, data: Partial<WorkflowNodeData>) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onReset: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDecomposeImages: (id: string) => void;
  onExport: () => void;
}

interface PreviewTarget {
  src: string;
  alt: string;
}

function parseCustomTypes(value: string) {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function baseComponentLabel(label: string) {
  return label.replace(/\d+$/, '');
}

function ComponentPlanEditor({
  node,
  onChange,
}: {
  node: WorkflowNode;
  onChange: (id: string, data: Partial<WorkflowNodeData>) => void;
}) {
  const plan = normalizeComponentPlan(node.data.componentPlan, node.data.componentTypes);
  const selected = selectedComponentSpecs(plan);
  const expandedTypes = componentTypesFromPlan(plan);
  const catalogLabels = new Set(plan.map((item) => item.label));
  const customTypes = (node.data.componentTypes ?? []).filter((type) => {
    const baseLabel = baseComponentLabel(type);
    return !catalogLabels.has(type) && !catalogLabels.has(baseLabel);
  });
  const totalCount = expandedTypes.length + customTypes.length;
  const estimatedSheets = Math.max(1, Math.ceil(Math.max(totalCount, 1) / 8));

  const commitPlan = (next: ComponentSpec[], nextCustomTypes = customTypes) => {
    onChange(node.id, {
      componentPlan: next,
      componentTypes: [...componentTypesFromPlan(next), ...nextCustomTypes],
    });
  };

  const patchItem = (id: string, patch: Partial<ComponentSpec>) => {
    commitPlan(plan.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const applyPreset = (mode: 'core' | 'screen' | 'economy') => {
    const next = plan.map((item) => {
      if (mode === 'core') {
        const enabled = ['button', 'panel', 'badge', 'progress', 'dialog', 'avatar'].includes(item.id);
        return { ...item, enabled, count: ['button', 'panel'].includes(item.id) ? 2 : 1 };
      }
      if (mode === 'screen') {
        const enabled = ['button', 'tab', 'panel', 'dialog', 'card', 'banner', 'progress', 'avatar', 'quickEntry'].includes(item.id);
        return { ...item, enabled, count: ['button', 'quickEntry'].includes(item.id) ? 3 : 1 };
      }
      const enabled = ['resourceIcon', 'coupon', 'reward', 'badge', 'toast'].includes(item.id);
      return { ...item, enabled, count: ['resourceIcon', 'badge'].includes(item.id) ? 4 : 2 };
    });
    commitPlan(next);
  };

  return (
    <div className="component-plan compact">
      <div className="component-plan-summary">
        <div>
          <span>组件生产计划</span>
          <strong>{selected.length} 类 / {totalCount} 个资产</strong>
          <small>预计 {estimatedSheets} 张组件板。数量会同步影响 prompt、格子和切片命名。</small>
        </div>
        <div className="component-plan-presets">
          <button type="button" onClick={() => applyPreset('core')}>核心 UI</button>
          <button type="button" onClick={() => applyPreset('screen')}>界面套件</button>
          <button type="button" onClick={() => applyPreset('economy')}>资源奖励</button>
        </div>
      </div>

      {COMPONENT_CATEGORIES.map((category) => {
        const categoryItems = category.items
          .map((catalogItem) => plan.find((entry) => entry.id === catalogItem.id))
          .filter((item): item is ComponentSpec => Boolean(item));
        const activeItems = categoryItems.filter((item) => item.enabled);
        const activeCount = activeItems.reduce((sum, item) => sum + item.count, 0);
        return (
          <details className="component-category" key={category.id} open={activeItems.length > 0}>
            <summary className="component-category-header">
              <div>
                <strong>{category.label}</strong>
                <small>{category.description}</small>
              </div>
              <span>{activeItems.length} 类 / {activeCount} 个</span>
            </summary>
            <div className="component-spec-grid">
              {categoryItems.map((item) => (
                <label className={`component-spec-row ${item.enabled ? 'active' : ''}`} key={item.id}>
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(event) => patchItem(item.id, { enabled: event.target.checked })}
                  />
                  <span>{item.label}</span>
                  <input
                    aria-label={`${item.label} 数量`}
                    className="component-count-input"
                    type="number"
                    min={1}
                    max={8}
                    value={item.count}
                    disabled={!item.enabled}
                    onChange={(event) => patchItem(item.id, { count: Math.max(1, Math.min(8, Number(event.target.value) || 1)) })}
                  />
                </label>
              ))}
            </div>
          </details>
        );
      })}

      <label className="field">
        <span>自定义补充组件</span>
        <textarea
          value={customTypes.join(', ')}
          onChange={(event) => commitPlan(plan, parseCustomTypes(event.target.value))}
          rows={2}
          placeholder="例如：排行榜条目, 抽卡入口, Boss 血条"
        />
      </label>
    </div>
  );
}

export function Inspector({
  node,
  selectedEdge,
  onChange,
  onRun,
  onDelete,
  onDeleteEdge,
  onReset,
  onDuplicate,
  onDecomposeImages,
  onExport,
}: InspectorProps) {
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);

  if (selectedEdge && !node) {
    return (
      <aside className="inspector">
        <div className="panel-heading">
          <div><span className="eyebrow">EDGE</span><h2>连接线</h2></div>
          <button className="icon-button danger" onClick={() => onDeleteEdge(selectedEdge.id)} aria-label="删除连接线"><Trash2 size={15} /></button>
        </div>
        <div className="inspector-content">
          <div className="edge-card">
            <GitBranch size={18} />
            <div><strong>{selectedEdge.source}</strong><span>→</span><strong>{selectedEdge.target}</strong></div>
          </div>
          <div className="shortcut-card">
            <strong>快捷操作</strong>
            <p>Ctrl + 左键点击连接线可直接断开；选中连接线后按 Delete 也可删除。</p>
          </div>
        </div>
      </aside>
    );
  }

  if (!node) {
    return (
      <aside className="inspector empty-inspector">
        <span className="eyebrow">INSPECT</span>
        <h2>属性面板</h2>
        <div className="empty-state">
          <span>→</span>
          <p>选择一个节点，查看输入、输出与运行参数。</p>
        </div>
      </aside>
    );
  }

  const updateText = (event: ChangeEvent<HTMLTextAreaElement>) => onChange(node.id, { text: event.target.value });
  const handleInspectorImageClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const image = target.closest('img') as HTMLImageElement | null;
    if (!image?.src) return;
    setPreviewTarget({ src: image.src, alt: image.alt || image.title || '图像预览' });
  };
  const uploadImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 5);
    const images = await Promise.all(files.map((file) => new Promise<{ id: string; name: string; dataUrl: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, dataUrl: String(reader.result) });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    })));
    onChange(node.id, { images, activeImageIndex: 0 });
  };
  const hasReusableVisualOutput = Boolean(
    node.data.stylePreview
    || node.data.screenImage
    || node.data.sheet
    || (node.data.extractedAssets?.length ?? 0) > 0
    || (node.data.slices?.length ?? 0) > 0,
  );

  return (
    <>
    <aside className="inspector" onClick={handleInspectorImageClick}>
      <div className="panel-heading">
        <div><span className="eyebrow">INSPECT</span><h2>{node.data.title}</h2></div>
        <div className="panel-actions">
          <button className="icon-button" onClick={() => onDuplicate(node.id)} aria-label="复制节点" title="复制节点（Ctrl + D）"><Copy size={15} /></button>
          <button className="icon-button" onClick={() => onReset(node.id)} aria-label="重置节点输出" title="重置节点输出"><RotateCcw size={15} /></button>
          <button className="icon-button danger" onClick={() => onDelete(node.id)} aria-label="删除节点" title="删除节点（Delete）"><Trash2 size={15} /></button>
        </div>
      </div>
      <div className="inspector-content">
        <div className="node-summary">
          <span className={`summary-dot ${node.data.status}`} />
          <div>
            <strong>{node.data.status === 'idle' ? '待运行' : node.data.status}</strong>
            <small>{node.data.durationMs ? `${node.data.durationMs} ms` : node.data.description}</small>
          </div>
        </div>

        <label className="field">
          <span>节点名称</span>
          <input value={node.data.title} onChange={(event) => onChange(node.id, { title: event.target.value })} />
        </label>

        {node.data.kind === 'text' && (
          <label className="field">
            <span>生成需求</span>
            <textarea value={node.data.text ?? ''} onChange={updateText} rows={7} />
          </label>
        )}

        {node.data.kind === 'screen' && (
          <label className="field">
            <span>界面生成提示词</span>
            <textarea
              value={node.data.text ?? ''}
              onChange={updateText}
              rows={6}
              placeholder="例如：完整的游戏个人信息界面，顶部导航，左侧角色展示，右侧属性卡片，底部两个主要按钮"
            />
          </label>
        )}

        {node.data.kind === 'images' && (
          <div className="field">
            <span>参考图（推荐 3-5 张）</span>
            <label className="upload-zone">
              <ImagePlus size={22} />
              <strong>选择图片</strong>
              <small>PNG、JPG、WebP</small>
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={uploadImages} />
            </label>
            <div className="image-list">
              {node.data.images?.map((image, index) => (
                <button
                  className={`image-thumb-button ${index === (node.data.activeImageIndex ?? 0) ? 'active' : ''}`}
                  key={image.id}
                  onClick={() => {
                    onChange(node.id, { activeImageIndex: index });
                    setPreviewTarget({ src: image.dataUrl, alt: image.name });
                  }}
                  title={`设为主图：${image.name}`}
                  type="button"
                >
                  <img src={image.dataUrl} alt={image.name} />
                </button>
              ))}
            </div>
            <button className="secondary-button full-width-button" type="button" onClick={() => onDecomposeImages(node.id)} disabled={(node.data.images?.length ?? 0) === 0}>
              拆解参考图
            </button>
          </div>
        )}

        {node.data.kind !== 'images' && hasReusableVisualOutput && (
          <button className="secondary-button full-width-button" type="button" onClick={() => onDecomposeImages(node.id)}>
            拆解此节点输出
          </button>
        )}

        {node.data.kind === 'style' && node.data.stylePack && (
          <>
            <div className="metric-card">
              <span>{node.data.stylePack.source === 'modelscope' ? 'AI 风格一致性' : '本地一致性'}</span>
              <strong>{node.data.stylePack.consistency}<small>/100</small></strong>
            </div>
            <div className="swatches">
              {node.data.stylePack.palette.map((color) => <span key={color} style={{ background: color }} title={color} />)}
            </div>
            <dl className="style-facts">
              <div><dt>材质</dt><dd>{node.data.stylePack.material}</dd></div>
              <div><dt>形状</dt><dd>{node.data.stylePack.shape}</dd></div>
              <div><dt>装饰</dt><dd>{node.data.stylePack.decoration}</dd></div>
            </dl>
            {node.data.stylePack.visualEvidence && node.data.stylePack.visualEvidence.length > 0 && (
              <div className="evidence-box">
                <span>参考图证据</span>
                <ul>{node.data.stylePack.visualEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            <label className="field">
              <span>结构化提示词</span>
              <textarea value={node.data.stylePack.prompt} readOnly rows={5} />
            </label>
            <label className="field">
              <span>反向提示词</span>
              <textarea value={node.data.stylePack.negativePrompt} readOnly rows={3} />
            </label>
          </>
        )}

        {node.data.stylePreview && <img className="large-preview" src={node.data.stylePreview.dataUrl} alt="风格提示词效果预览" />}
        {node.data.screenImage && <img className="large-preview" src={node.data.screenImage.dataUrl} alt="完整界面生成预览" />}

        {node.data.analysisItems && node.data.analysisItems.length > 0 && (
          <div className="evidence-box">
            <span>拆解结果</span>
            <ul>{node.data.analysisItems.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        )}

        {node.data.extractedAssets && node.data.extractedAssets.length > 0 && (
          <div className="field">
            <span>候选拆解资产</span>
            <div className="slice-grid">
              {node.data.extractedAssets.map((asset) => <img key={asset.id} src={asset.dataUrl} alt={asset.name} title={asset.name} />)}
            </div>
          </div>
        )}

        {node.data.classifications && node.data.classifications.length > 0 && (
          <div className="evidence-box">
            <span>AI 视觉分类</span>
            <ul>
              {node.data.classifications.map((item) => (
                <li key={`${item.index}-${item.name}`}>
                  #{item.index + 1} {item.keep ? '保留' : '丢弃'} · {item.category} · {item.name} · {Math.round(item.confidence * 100)}%
                </li>
              ))}
            </ul>
          </div>
        )}

        {node.data.kind === 'components' && <ComponentPlanEditor node={node} onChange={onChange} />}

        {node.data.sheet && <img className="large-preview" src={node.data.sheet.dataUrl} alt="组件板预览" />}
        {node.data.slices && node.data.slices.length > 0 && (
          <div className="slice-grid">
            {node.data.slices.map((slice) => <img key={slice.id} src={slice.dataUrl} alt={slice.name} title={slice.name} />)}
          </div>
        )}
        {node.data.message && (
          <details className={`run-message ${node.data.status}`} open={node.data.message.length < 220}>
            <summary>{node.data.status === 'error' ? '错误详情' : '运行消息'}</summary>
            <p>{node.data.message}</p>
            {node.data.message.length > 80 && (
              <button className="tiny-button" onClick={() => navigator.clipboard?.writeText(node.data.message ?? '')}>
                <Copy size={12} />复制消息
              </button>
            )}
          </details>
        )}
      </div>
      <div className="inspector-actions">
        <button className="primary-button" onClick={() => onRun(node.id)} disabled={node.data.status === 'running'}>
          <Play size={15} fill="currentColor" />运行此节点
        </button>
        {node.data.kind === 'export' && <button className="secondary-button" onClick={onExport}><Download size={15} />下载 ZIP</button>}
      </div>
    </aside>
    {previewTarget && (
      <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="图像放大预览" onClick={() => setPreviewTarget(null)}>
        <button className="image-lightbox-close" type="button" aria-label="关闭图像预览" onClick={() => setPreviewTarget(null)}>×</button>
        <img src={previewTarget.src} alt={previewTarget.alt} onClick={(event) => event.stopPropagation()} />
        <span>{previewTarget.alt}</span>
      </div>
    )}
    </>
  );
}
