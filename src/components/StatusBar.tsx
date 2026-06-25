import { Box, CircleCheck, Cpu, MousePointer2 } from 'lucide-react';

interface StatusBarProps {
  nodeCount: number;
  edgeCount: number;
  successCount: number;
  aiEnabled: boolean;
}

export function StatusBar({ nodeCount, edgeCount, successCount, aiEnabled }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span><CircleCheck size={13} />就绪</span>
      <span><Box size={13} />{nodeCount} 节点 · {edgeCount} 连接</span>
      <span><Cpu size={13} />{successCount}/{nodeCount} 已执行</span>
      <span className="status-tip"><MousePointer2 size={13} />拖动画布 · 滚轮缩放 · 连线定义数据流</span>
      <span>{aiEnabled ? 'ModelScope API · v0.2' : 'Local engine · v0.2'}</span>
    </footer>
  );
}
