import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { NODE_REGISTRY } from '../data/nodeRegistry';
import type { WorkflowNode } from '../types/workflow';

type StudioNodeData = WorkflowNode['data'] & {
  onSetActiveImage?: (index: number) => void;
};

function StatusIcon({ status }: { status: WorkflowNode['data']['status'] }) {
  if (status === 'running' || status === 'queued') return <LoaderCircle className="spin" size={14} />;
  if (status === 'success') return <Check size={14} />;
  if (status === 'error' || status === 'warning') return <CircleAlert size={14} />;
  return <span className="status-dot" />;
}

function StudioNodeView({ data, selected }: NodeProps<WorkflowNode>) {
  const nodeData = data as StudioNodeData;
  const definition = NODE_REGISTRY[data.kind];
  const Icon = definition.icon;
  const imageCount = nodeData.images?.length ?? 0;
  const activeImageIndex = Math.min(Math.max(nodeData.activeImageIndex ?? 0, 0), Math.max(imageCount - 1, 0));
  const activeImage = nodeData.images?.[activeImageIndex];
  const preview = data.stylePreview?.dataUrl ?? data.sheet?.dataUrl ?? activeImage?.dataUrl ?? data.slices?.[0]?.dataUrl;
  const message = data.message && data.message.length > 84 ? `${data.message.slice(0, 84)}…` : data.message;

  return (
    <article
      className={`studio-node ${selected ? 'is-selected' : ''}`}
      data-node-id={(data as WorkflowNode['data'] & { id?: string }).id}
      style={{ '--node-accent': definition.color } as React.CSSProperties}
    >
      <span className={`node-status-stripe status-${data.status}`} />
      {definition.accepts.length > 0 && <Handle type="target" position={Position.Left} className="node-handle" />}
      <header className="node-header">
        <span className="node-icon"><Icon size={15} /></span>
        <span className="node-title">{data.title}</span>
        <span className={`node-status status-${data.status}`}><StatusIcon status={data.status} /></span>
      </header>
      <div className="node-body">
        {preview ? <img className="node-preview" src={preview} alt={`${data.title}预览`} /> : <p>{data.description}</p>}
        {data.kind === 'images' && imageCount > 1 && (
          <div className="node-thumb-strip" aria-label="参考图缩略图">
            {nodeData.images?.map((image, index) => (
              <button
                key={image.id}
                className={`node-thumb ${index === activeImageIndex ? 'active' : ''}`}
                draggable
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/x-styleslice-image', JSON.stringify({
                    sourceNodeId: (data as WorkflowNode['data'] & { id?: string }).id,
                    imageId: image.id,
                  }));
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  nodeData.onSetActiveImage?.(index);
                }}
                title={image.name}
                type="button"
              >
                <img src={image.dataUrl} alt={image.name} />
              </button>
            ))}
          </div>
        )}
        {data.stylePack && (
          <div className="palette-strip" aria-label="风格色板">
            {data.stylePack.palette.map((color) => <span key={color} style={{ background: color }} title={color} />)}
          </div>
        )}
        {data.kind === 'images' && <small>{imageCount} / 5 张参考图{imageCount > 1 ? ` · 主图 ${activeImageIndex + 1}` : ''}</small>}
        {data.kind === 'style' && data.stylePack && <small>{data.stylePack.source === 'modelscope' ? 'AI 风格包' : '本地风格包'} · {data.stylePack.consistency}/100</small>}
        {data.kind === 'components' && <small>{data.componentTypes?.length ?? 0} 类组件 · {data.sheet ? '已有组件板' : '待生成'}</small>}
        {data.kind === 'slice' && <small>{data.slices?.length ?? 0} 个透明切片</small>}
        {data.kind === 'export' && <small>{data.slices?.length ?? 0} 个导出资产</small>}
        {data.analysisItems && data.analysisItems.length > 0 && <small>{data.analysisItems.length} 条拆解结果</small>}
        {message && <small className={`node-message status-${data.status}`}>{message}</small>}
      </div>
      {data.kind !== 'export' && <Handle type="source" position={Position.Right} className="node-handle" />}
    </article>
  );
}

export const StudioNode = memo(StudioNodeView);
