import { Bot, Cloud, Download, FolderKanban, LayoutGrid, Play, Plus, RotateCcw, Save } from 'lucide-react';

interface TopBarProps {
  projectName: string;
  saved: boolean;
  running: boolean;
  aiEnabled: boolean;
  onProjectNameChange: (name: string) => void;
  onNewProject: () => void;
  onManageProjects: () => void;
  onRunAll: () => void;
  onSaveProject: () => void;
  onExportProject: () => void;
  onOpenAiSettings: () => void;
  onAutoLayout: () => void;
  onResetRunState: () => void;
}

export function TopBar({
  projectName,
  saved,
  running,
  aiEnabled,
  onProjectNameChange,
  onNewProject,
  onManageProjects,
  onRunAll,
  onSaveProject,
  onExportProject,
  onOpenAiSettings,
  onAutoLayout,
  onResetRunState,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"><i /><i /><i /></span>
        <strong>StyleSlice</strong>
        <span className="version">MVP</span>
      </div>
      <div className="project-title">
        <span>项目</span>
        <input
          className="project-name-input"
          value={projectName}
          onChange={(event) => onProjectNameChange(event.target.value)}
          aria-label="项目名称"
        />
        <small><Cloud size={12} />{saved ? '已保存到本地' : '有未保存更改'}</small>
      </div>
      <div className="topbar-actions">
        <button className="secondary-button compact-button" onClick={onNewProject} title="新建项目">
          <Plus size={15} />新建
        </button>
        <button className="secondary-button compact-button" onClick={onManageProjects} title="管理本地项目">
          <FolderKanban size={15} />项目
        </button>
        <button className="secondary-button compact-button" onClick={onSaveProject} title="保存到本地">
          <Save size={15} />保存
        </button>
        <button className="secondary-button compact-button" onClick={onAutoLayout} title="自动整理节点（Ctrl + L）">
          <LayoutGrid size={15} />整理
        </button>
        <button className="secondary-button compact-button" onClick={onResetRunState} title="清空运行结果">
          <RotateCcw size={15} />清空状态
        </button>
        <span className="divider" />
        <button className={`secondary-button ${aiEnabled ? 'ai-active' : ''}`} onClick={onOpenAiSettings}>
          <Bot size={15} />{aiEnabled ? 'AI 已启用' : 'AI 设置'}
        </button>
        <button className="secondary-button" onClick={onExportProject}><Download size={15} />导出 JSON</button>
        <button className="primary-button run-all" onClick={onRunAll} disabled={running}>
          <Play size={14} fill="currentColor" />{running ? '执行中…' : '运行工作流'}
        </button>
      </div>
    </header>
  );
}
