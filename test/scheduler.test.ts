import { describe, expect, it } from 'vitest';
import { GitScheduler } from '../src/extension/git/GitScheduler';

/** A task that resolves only when its returned `release` is called. */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('GitScheduler — concurrency', () => {
  it('never runs more tasks than the pool allows', async () => {
    const scheduler = new GitScheduler(2);
    const gates = [gate(), gate(), gate(), gate()];

    const results = gates.map((g, i) =>
      scheduler.schedule({ repoId: `r${i}` }, async () => {
        await g.promise;
        return i;
      }),
    );

    await tick();
    expect(scheduler.active).toBe(2);
    expect(scheduler.queued).toBe(2);

    gates[0]!.release();
    gates[1]!.release();
    await tick();
    expect(scheduler.active).toBe(2);

    gates[2]!.release();
    gates[3]!.release();
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3]);
    expect(scheduler.active).toBe(0);
  });

  it('keeps draining after a task rejects', async () => {
    const scheduler = new GitScheduler(1);

    const failed = scheduler.schedule({ repoId: 'a' }, async () => {
      throw new Error('boom');
    });
    const succeeded = scheduler.schedule({ repoId: 'a' }, async () => 'ok');

    await expect(failed).rejects.toThrow('boom');
    expect(await succeeded).toBe('ok');
  });
});

describe('GitScheduler — priority', () => {
  it('runs foreground work before queued background work', async () => {
    const scheduler = new GitScheduler(1);
    const blocker = gate();
    const order: string[] = [];

    void scheduler.schedule({ repoId: 'a', priority: 'foreground' }, async () => {
      await blocker.promise;
      order.push('first');
    });

    await tick();

    void scheduler.schedule({ repoId: 'a', priority: 'background' }, async () => {
      order.push('background');
    });
    const last = scheduler.schedule({ repoId: 'a', priority: 'foreground' }, async () => {
      order.push('foreground');
    });

    blocker.release();
    await last;
    await tick();

    expect(order).toEqual(['first', 'foreground', 'background']);
  });
});

describe('GitScheduler — fairness across repositories', () => {
  it('round-robins rather than draining one repository first', async () => {
    // Without per-repo round-robin, a repository that enqueues a burst of work
    // holds every slot and the others never start.
    const scheduler = new GitScheduler(1);
    const blocker = gate();
    const order: string[] = [];

    void scheduler.schedule({ repoId: 'warmup' }, async () => {
      await blocker.promise;
    });
    await tick();

    for (const repoId of ['big', 'big', 'big', 'small']) {
      void scheduler.schedule({ repoId }, async () => {
        order.push(repoId);
      });
    }

    blocker.release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // `small` must not be last behind all three `big` tasks.
    expect(order.indexOf('small')).toBeLessThan(3);
    expect(order).toHaveLength(4);
  });
});

describe('GitScheduler — cancellation', () => {
  it('rejects a queued task when its signal aborts', async () => {
    const scheduler = new GitScheduler(1);
    const blocker = gate();

    void scheduler.schedule({ repoId: 'a' }, async () => {
      await blocker.promise;
    });
    await tick();

    const controller = new AbortController();
    const queued = scheduler.schedule({ repoId: 'b', signal: controller.signal }, async (signal) => {
      if (signal.aborted) throw new Error('aborted before start');
      return 'ran';
    });

    controller.abort();
    blocker.release();

    // The task still runs, but observes an already-aborted signal.
    await expect(queued).rejects.toThrow();
  });

  it('rejects immediately when handed an already-aborted signal', async () => {
    const scheduler = new GitScheduler(2);
    const controller = new AbortController();
    controller.abort();

    await expect(
      scheduler.schedule({ repoId: 'a', signal: controller.signal }, async () => 'never'),
    ).rejects.toThrow(/cancelled/i);
  });

  it('propagates the signal into the running task', async () => {
    const scheduler = new GitScheduler(1);
    const controller = new AbortController();
    let observed = false;

    const running = scheduler.schedule({ repoId: 'a', signal: controller.signal }, async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          observed = true;
          resolve();
        });
      });
    });

    await tick();
    controller.abort();
    await running;

    expect(observed).toBe(true);
  });

  it('cancelRepo drops queued work for that repository only', async () => {
    const scheduler = new GitScheduler(1);
    const blocker = gate();

    void scheduler.schedule({ repoId: 'busy' }, async () => {
      await blocker.promise;
    });
    await tick();

    const doomed = scheduler.schedule({ repoId: 'doomed' }, async () => 'x');
    const kept = scheduler.schedule({ repoId: 'kept' }, async () => 'y');

    scheduler.cancelRepo('doomed');
    blocker.release();

    await expect(doomed).rejects.toThrow(/cancelled/i);
    expect(await kept).toBe('y');
  });

  it('dispose rejects everything still queued', async () => {
    const scheduler = new GitScheduler(1);
    const blocker = gate();

    void scheduler.schedule({ repoId: 'a' }, async () => {
      await blocker.promise;
    });
    await tick();

    const queued = scheduler.schedule({ repoId: 'b' }, async () => 'never');
    scheduler.dispose();

    await expect(queued).rejects.toThrow(/cancelled/i);
    blocker.release();
  });
});
