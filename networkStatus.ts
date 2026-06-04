import NetInfo, {NetInfoState} from '@react-native-community/netinfo';

export type NetListener = (online: boolean) => void;

/** True if the device currently has a usable internet connection. */
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

/**
 * Subscribe to connectivity changes. Returns an unsubscribe function.
 * The sync service uses this to drain the queue the moment network returns.
 */
export function onConnectivityChange(cb: NetListener): () => void {
  return NetInfo.addEventListener((state: NetInfoState) => {
    cb(Boolean(state.isConnected && state.isInternetReachable !== false));
  });
}
