// A small pool of background workers, each holding its own copy of the engine.
export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

type Kind = 'run' | 'whatif';
interface Task {
  id: number;
  kind: Kind;
  spec: unknown;
  onProgress?: (fraction: number, message: string) => void;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}
interface Slot {
  worker: Worker;
  ready: boolean;
  dead: boolean;
  task: Task | null;
}
interface Hooks {
  onBoot(message: string): void;
  onReady(workers: number, info: { versions: Record<string, string>; memoryMB: number }): void;
  onBusy(busy: number): void;
  onFailed(error: string): void;
}

let slots: Slot[] = [];
let queue: Task[] = [];
let hooks: Hooks | null = null;
let nextId = 1;
let lastInfo = { versions: {} as Record<string, string>, memoryMB: 0 };

function spawn(): Slot {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const slot: Slot = { worker, ready: false, dead: false, task: null };
  // A worker that has not come up after two minutes is not going to.
  setTimeout(() => {
    if (!slot.ready) died(slot, 'The engine took too long to start on this device. Close other tabs or apps and try again.');
  }, 120_000);
  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'boot') hooks?.onBoot(msg.message);
    else if (msg.type === 'ready') {
      slot.ready = true;
      lastInfo = { versions: msg.versions, memoryMB: msg.memoryMB };
      hooks?.onReady(slots.filter((s) => s.ready).length, lastInfo);
      pump();
    } else if (msg.type === 'fatal') died(slot, msg.message);
    else if (!slot.task || msg.id !== slot.task.id) return;
    else if (msg.type === 'progress') slot.task.onProgress?.(msg.fraction, msg.message);
    else if (msg.type === 'result' || msg.type === 'error') {
      const task = slot.task;
      slot.task = null;
      if (msg.type === 'result') task.resolve(msg.result);
      else task.reject(new Error(msg.message));
      announce();
      pump();
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    died(slot, event.message || 'The engine stopped unexpectedly.');
  };
  return slot;
}

function died(slot: Slot, reason: string) {
  if (slot.dead) return;
  slot.dead = true;
  slot.worker.terminate();
  const wasReady = slot.ready;
  slot.ready = false;
  slot.task?.reject(new Error(reason));
  slot.task = null;
  slots = slots.filter((s) => s !== slot);
  if (wasReady) {
    slots.push(spawn()); // it worked before, so start a fresh one
  } else if (!slots.length) {
    const waiting = queue;
    queue = [];
    waiting.forEach((t) => t.reject(new Error(reason)));
    hooks?.onFailed(reason);
    return;
  }
  announce();
  pump();
}

function announce() {
  hooks?.onBusy(slots.filter((s) => s.task).length);
}

function pump() {
  for (const slot of slots) {
    if (!slot.ready || slot.task || !queue.length) continue;
    const task = queue.shift()!;
    slot.task = task;
    slot.worker.postMessage({ type: task.kind, id: task.id, spec: task.spec });
  }
  announce();
}

export function startPool(size: number, h: Hooks) {
  stopPool();
  hooks = h;
  slots = Array.from({ length: Math.max(1, size) }, spawn);
}

export function stopPool() {
  for (const slot of slots) {
    slot.dead = true;
    slot.worker.terminate();
    slot.task?.reject(new Cancelled());
  }
  queue.forEach((t) => t.reject(new Cancelled()));
  slots = [];
  queue = [];
}

export function submit<T>(
  kind: Kind,
  spec: unknown,
  onProgress?: (fraction: number, message: string) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ id: nextId++, kind, spec, onProgress, resolve: resolve as (v: unknown) => void, reject });
    pump();
  });
}

/** Stops every forecast in progress. Busy workers are replaced with fresh ones. */
export function cancelRuns() {
  queue = queue.filter((t) => {
    if (t.kind !== 'run') return true;
    t.reject(new Cancelled());
    return false;
  });
  for (const slot of [...slots]) {
    if (slot.task?.kind !== 'run') continue;
    slot.dead = true;
    slot.worker.terminate();
    slot.task.reject(new Cancelled());
    slots[slots.indexOf(slot)] = spawn();
  }
  announce();
}

/** Tells every worker to drop the fitted models it keeps for the what-if. */
export function forgetModels() {
  slots.forEach((s) => s.ready && s.worker.postMessage({ type: 'forget' }));
}
