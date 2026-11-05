import { useEffect, useState, useSyncExternalStore } from 'react';
import { PanelConnection, type PanelState } from '../connection';

export function usePanelConnection(): { state: PanelState; connection: PanelConnection } {
  const [connection] = useState(() => new PanelConnection());
  useEffect(() => {
    void connection.start();
    return () => connection.dispose();
  }, [connection]);
  const state = useSyncExternalStore(connection.subscribe, connection.getState);
  return { state, connection };
}
