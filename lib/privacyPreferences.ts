import AsyncStorage from '@react-native-async-storage/async-storage';

const REPLAY_KEY = 'gymup_privacy_session_replay_v1';

/** Session replay es opcional y apagado por defecto en una app con datos de salud. */
export async function getSessionReplayConsent(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(REPLAY_KEY)) === 'granted'; } catch { return false; }
}

export async function saveSessionReplayConsent(granted: boolean): Promise<void> {
  await AsyncStorage.setItem(REPLAY_KEY, granted ? 'granted' : 'denied');
}
