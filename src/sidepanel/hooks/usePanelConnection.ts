import { useEffect, useState } from 'preact/hooks';
import { PanelConnection, type PanelState } from '../connection';

export function usePanelConnection(): { state: PanelState; connection: PanelConnection } {
  const [connection] = useState(() => new PanelConnection());
  const [state, setState] = useState(connection.getState);
  useEffect(() => {
    // Subscribe before starting so no state change is missed.
    const unsubscribe = connection.subscribe(() => setState(connection.getState()));
    void connection.start();
    return () => {
      unsubscribe();
      connection.dispose();
    };
  }, [connection]);
  return { state, connection };
}
