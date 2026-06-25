import { Copy, Download, GitBranch, ImagePlus, Play, RotateCcw, Trash2 } from 'lucide-react';
import type { ChangeEvent } from 'react';
import type { WorkflowEdge, WorkflowNode, WorkflowNodeData } from '../types/workflow';

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
            <div>
              <strong>{selectedEdge.source}</strong>
              <span>→</span>
              <strong>{selectedEdge.target}</strong>
            </div>
          </div>
          <div className="shortcut-card">
            <strong>快捷操作</strong>
            <p>Ctrl + 左键点击任意连接线，可直接断开该连接。选中连接线后按 Delete 也可以删除。</p>
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

  return (
    <aside className="inspector">
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

        {node.data.kind === 'images' && (
          <div className="field">
            <span>参考图（推荐 3–5 张）</span>
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
                  onClick={() => onChange(node.id, { activeImageIndex: index })}
                  title={`设为主图：${image.name}`}
                  type="button"
                >
                  <img src={image.dataUrl} alt={image.name} />
                </button>
              ))}
            </div>
            <button
              className="secondary-button full-width-button"
              type="button"
              onClick={() => onDecomposeImages(node.id)}
              disabled={(node.data.images?.length ?? 0) === 0}
            >
              拆解参考图
            </button>
          </div>
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
                <ul>
                  {node.data.stylePack.visualEvidence.map((item) => <li key={item}>{item}</li>)}
                </ul>
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
        {node.data.analysisItems && node.data.analysisItems.length > 0 && (
          <div className="evidence-box">
            <span>拆解结果</span>
            <ul>
              {node.data.analysisItems.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}
        {node.data.extractedAssets && node.data.extractedAssets.length > 0 && (
          <div className="field">
            <span>候选拆解资产</span>
            <div className="slice-grid">
              {node.data.extractedAssets.map((asset) => (
                <img key={asset.id} src={asset.dataUrl} alt={asset.name} title={asset.name} />
              ))}
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
        {node.data.kind === 'components' && (
          <>
            <label className="field">
              <span>组件类型列表</span>
              <textarea
                value={(node.data.componentTypes ?? []).join(', ')}
                onChange={(event) => onChange(node.id, {
                  componentTypes: event.target.value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
                })}
                rows={4}
                placeholder="按钮, 面板, 徽章, 进度条, 对话框, 头像框"
              />
            </label>
            <fieldset className="field checkbox-grid">
              <legend>快捷模板</legend>
              {['按钮', '面板', '徽章', '进度条', '对话框', '头像框', '任务卡片', '资源图标'].map((type) => (
                <label key={type}>
                  <input
                    type="checkbox"
                    checked={node.data.componentTypes?.includes(type)}
                    onChange={(event) => onChange(node.id, {
                      componentTypes: event.target.checked
                        ? Array.from(new Set([...(node.data.componentTypes ?? []), type]))
                        : (node.data.componentTypes ?? []).filter((item) => item !== type),
                    })}
                  />
                  {type}
                </label>
              ))}
            </fieldset>
          </>
        )}

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
  );
}
