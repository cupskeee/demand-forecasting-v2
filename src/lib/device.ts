import type { Mode } from './types';

export interface Device {
  cores: number;
  /** Approximate memory in GB, where the browser reports it. */
  memory: number | null;
  phone: boolean;
  lowEnd: boolean;
  workers: number;
  suggestedMode: Mode;
  reason: string;
}

export function describeDevice(): Device {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  const phone =
    matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  const lowEnd = phone || cores <= 2 || (memory !== null && memory <= 4);
  const what = `${cores} processor cores${memory ? ` and about ${memory} GB of memory` : ''}`;
  return {
    cores,
    memory,
    phone,
    lowEnd,
    workers: lowEnd ? 1 : 2,
    suggestedMode: lowEnd ? 'quick' : 'thorough',
    reason: lowEnd
      ? `Quick is suggested: this device reports ${what}.`
      : `Thorough is suggested: this device reports ${what}, which is plenty.`,
  };
}

/** Features the app cannot work without. Returns what is missing, in plain words. */
export function missingFeatures(): string[] {
  const missing: string[] = [];
  if (typeof WebAssembly !== 'object') missing.push('WebAssembly');
  if (typeof Worker !== 'function') missing.push('background workers');
  if (typeof indexedDB !== 'object') missing.push('IndexedDB storage');
  if (typeof caches !== 'object') missing.push('offline file storage');
  if (!crypto?.subtle) missing.push('checksum support (the page must be served over HTTPS)');
  return missing;
}
