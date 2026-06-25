import { ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NODE_ORDER, NODE_REGISTRY } from '../data/nodeRegistry';
import type { NodeKind } from '../types/workflow';

interface NodePaletteProps {
  onAddNode: (kind: NodeKind) => void;
}

export function NodePalette({ onAddNode }: NodePaletteProps) {
  const [query, setQuery] = useState('');
  const visibleKinds = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return NODE_ORDER;
    return NODE_ORDER.filter((kind) => {
      const definition = NODE_REGISTRY[kind];
      return [definition.label, definition.shortLabel, definition.description, kind]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [query]);

  return (
    <aside className="node-palette" aria-label="节点库">
      <div className="panel-heading">
        <div><span className="eyebrow">BUILD</span><h2>节点库</h2></div>
        <span className="key-hint">N</span>
      </div>
      <label className="search-box">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节点" aria-label="搜索节点" />
      </label>
      <p className="section-label">核心流程</p>
      <div className="palette-list">
        {visibleKinds.map((kind) => {
          const definition = NODE_REGISTRY[kind];
          const Icon = definition.icon;
          return (
            <button key={kind} className="palette-item" onClick={() => onAddNode(kind)}>
              <span className="palette-icon" style={{ color: definition.color }}><Icon size={16} /></span>
              <span><strong>{definition.label}</strong><small>{definition.description}</small></span>
              <ChevronRight size={14} />
            </button>
          );
        })}
        {visibleKinds.length === 0 && <p className="palette-empty">没有匹配的节点</p>}
      </div>
      <div className="palette-note">
        <span className="note-dot" />
        <p><strong>本地优先</strong><br />未配置 AI 时仍可用本地 Canvas 跑完整流程；配置后会调用 ModelScope。</p>
      </div>
    </aside>
  );
}
