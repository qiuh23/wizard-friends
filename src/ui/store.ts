import { useSyncExternalStore } from 'react';
import type { UIModel } from './types';

let snapshot: UIModel;
const listeners = new Set<() => void>();
export function publish(model: UIModel) { snapshot = model; listeners.forEach(listener => listener()); }
export function patchDraft(patch: Partial<UIModel>) { publish({...snapshot, ...patch}); }
export function useUIModel() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => snapshot);
}
