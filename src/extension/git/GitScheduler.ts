import { cpus } from 'node:os';
import type { RepoId } from '@shared/model';
import { CancelledError } from './GitProcess';

/**
 * Why a task was queued. Higher bands run first.
 *
 *  - `foreground` — the user is waiting: a click, a commit, a stage.
 *  - `visible`    — refreshing something already on screen.
 *  - `background` — speculative work: prefetch, warming a cache.
 */
export type Priority = 'foreground' | 'visible' | 'background';

const BANDS: readonly Priority[] = ['foreground', 'visible', 'background'];

export interface ScheduleOptions {
  repoId: RepoId;
  priority?: Priority;
  signal?: AbortSignal;
}

interface Task<T = unknown> {
  repoId: RepoId;
  run: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  controller: AbortController;
  external?: AbortSignal;
  onExternalAbort?: () => void;
}

/** Default pool size: leave headroom for the extension host and the editor. */
export function defaultConcurrency(): number {
  return Math.max(2, Math.min(8, cpus().length - 2));
}

/**
 * One git process pool for the whole extension.
 *
 * A pool per repository is the obvious design and the wrong one: with twenty
 * repositories in a workspace it permits twenty times the intended concurrency,
 * and a scan storm starves the editor. A single pool with per-repository
 * round-robin gives a bounded process count *and* stops one 200k-commit
 * monorepo from monopolising every slot while twenty small repos wait.
 */
export class GitScheduler {
  private readonly queues = new Map<Priority, Map<RepoId, Task[]>>();
  private readonly cursors = new Map<Priority, number>();
  private running = 0;
  private disposed = false;

  constructor(readonly concurrency: number = defaultConcurrency()) {
    for (const band of BANDS) {
      this.queues.set(band, new Map());
      this.cursors.set(band, 0);
    }
  }

  /** Queues work and resolves with its result once a slot frees up. */
  schedule<T>(options: ScheduleOptions, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new CancelledError());

    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const task: Task<T> = {
        repoId: options.repoId,
        run,
        resolve,
        reject,
        controller,
      };

      // A caller-supplied signal aborts the task whether it is queued or
      // already running.
      if (options.signal) {
        if (options.signal.aborted) {
          reject(new CancelledError());
          return;
        }
        const onAbort = () => controller.abort();
        options.signal.addEventListener('abort', onAbort, { once: true });
        task.external = options.signal;
        task.onExternalAbort = onAbort;
      }

      const band = this.queues.get(options.priority ?? 'visible');
      const bucket = band?.get(options.repoId);
      if (bucket) bucket.push(task as Task);
      else band?.set(options.repoId, [task as Task]);

      this.pump();
    });
  }

  /** Number of tasks waiting across every band. */
  get queued(): number {
    let total = 0;
    for (const band of this.queues.values()) {
      for (const bucket of band.values()) total += bucket.length;
    }
    return total;
  }

  get active(): number {
    return this.running;
  }

  /** Cancels every queued and running task for one repository. */
  cancelRepo(repoId: RepoId): void {
    for (const band of this.queues.values()) {
      const bucket = band.get(repoId);
      if (!bucket) continue;
      for (const task of bucket) this.settleCancelled(task);
      band.delete(repoId);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const band of this.queues.values()) {
      for (const bucket of band.values()) {
        for (const task of bucket) this.settleCancelled(task);
      }
      band.clear();
    }
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      const task = this.take();
      if (!task) return;

      this.running++;
      void this.execute(task);
    }
  }

  private async execute(task: Task): Promise<void> {
    try {
      const value = await task.run(task.controller.signal);
      task.resolve(value);
    } catch (error) {
      task.reject(error);
    } finally {
      this.running--;
      this.detach(task);
      this.pump();
    }
  }

  /**
   * Picks the next task: highest non-empty band, then round-robin across the
   * repositories waiting in it.
   */
  private take(): Task | undefined {
    for (const band of BANDS) {
      const queue = this.queues.get(band);
      if (!queue || queue.size === 0) continue;

      const repoIds = [...queue.keys()];
      const start = (this.cursors.get(band) ?? 0) % repoIds.length;

      for (let offset = 0; offset < repoIds.length; offset++) {
        const index = (start + offset) % repoIds.length;
        const repoId = repoIds[index];
        if (repoId === undefined) continue;

        const bucket = queue.get(repoId);
        const task = bucket?.shift();
        if (!task) {
          queue.delete(repoId);
          continue;
        }

        if (bucket && bucket.length === 0) queue.delete(repoId);
        // Advance past the repo just served so the next pick starts elsewhere.
        this.cursors.set(band, index + 1);
        return task;
      }
    }

    return undefined;
  }

  private settleCancelled(task: Task): void {
    task.controller.abort();
    this.detach(task);
    task.reject(new CancelledError());
  }

  private detach(task: Task): void {
    if (task.external && task.onExternalAbort) {
      task.external.removeEventListener('abort', task.onExternalAbort);
    }
  }
}
