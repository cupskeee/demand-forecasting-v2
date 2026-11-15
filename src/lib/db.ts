// All of the visitor's data lives here, in the browser's IndexedDB. Nothing in this
// file talks to the network.
import type { Dataset, Run } from './types';
import { createStore } from './store';

const DB_NAME = 'demand-forecasting';
const DB_VERSION = 1;
let opening: Promise<IDBDatabase> | null = null;

/** Bumped whenever stored data changes, so screens and the storage meter refresh. */
export const dataVersion = createStore(0);
const touch = () => dataVersion.set((v) => v + 1);

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('datasets')) db.createObjectStore('datasets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('runs')) {
        db.createObjectStore('runs', { keyPath: 'id' }).createIndex('datasetId', 'datasetId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage'));
    request.onblocked = () => reject(new Error('Browser storage is in use by another tab'));
  });
  return opening;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: 'datasets' | 'runs', mode: IDBTransactionMode) {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function listDatasets(): Promise<Dataset[]> {
  const all = await request((await store('datasets', 'readonly')).getAll() as IDBRequest<Dataset[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function getDataset(id: string): Promise<Dataset | undefined> {
  return request((await store('datasets', 'readonly')).get(id) as IDBRequest<Dataset | undefined>);
}
export async function putDataset(dataset: Dataset): Promise<void> {
  await request((await store('datasets', 'readwrite')).put(dataset));
  touch();
}
export async function deleteDataset(id: string): Promise<void> {
  await request((await store('datasets', 'readwrite')).delete(id));
  touch();
}

export async function listRuns(): Promise<Run[]> {
  const all = await request((await store('runs', 'readonly')).getAll() as IDBRequest<Run[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function getRun(id: string): Promise<Run | undefined> {
  return request((await store('runs', 'readonly')).get(id) as IDBRequest<Run | undefined>);
}
export async function putRun(run: Run): Promise<void> {
  await request((await store('runs', 'readwrite')).put(run));
  touch();
}
export async function deleteRun(id: string): Promise<void> {
  await request((await store('runs', 'readwrite')).delete(id));
  touch();
}

/** Deletes every dataset and run. */
export async function deleteAllData(): Promise<void> {
  if (opening) (await opening).close();
  opening = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/** Small settings only; everything else is in IndexedDB. */
export const settings = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`df2.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`df2.${key}`, value);
    } catch {
      /* private mode: the setting just does not persist */
    }
  },
  clear() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('df2.'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* nothing to clear */
    }
  },
};
