import { ReactFlowProvider } from '@xyflow/react';
import { Workspace } from './components/Workspace';

export function App() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}
