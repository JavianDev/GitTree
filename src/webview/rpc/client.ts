import type {
  EventName,
  Events,
  HostMessage,
  Method,
  Params,
  Result,
  RpcError,
  WebviewMessage,
} from '@shared/protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** An RPC failure carrying git's own output where there is any. */
export class RpcRequestError extends Error {
  constructor(readonly detail: RpcError) {
    super(detail.message);
    this.name = 'RpcRequestError';
  }

  /**
   * The text worth showing the user.
   *
   * For a failing hook, stderr *is* the message — the summary line is just its
   * first line — so the full output wins whenever it exists.
   */
  get displayText(): string {
    return this.detail.stderr?.trim() || this.detail.message;
  }
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

/**
 * Typed message bridge to the extension host.
 *
 * `request` is generic over the method table in `@shared/protocol`, so a
 * mismatched parameter or an unhandled result shape is a compile error rather
 * than a runtime surprise in a sandbox with no debugger attached.
 */
class RpcClient {
  private readonly api = acquireVsCodeApi();
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<EventName, Set<(payload: never) => void>>();
  private nextId = 1;

  constructor() {
    window.addEventListener('message', (event: MessageEvent<HostMessage>) => this.receive(event.data));
  }

  /** Tells the host the view is mounted and wants its initial state. */
  ready(): void {
    this.post({ kind: 'ready' });
  }

  request<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
    const id = this.nextId++;

    return new Promise<Result<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.post({ kind: 'request', id, method, params });
    });
  }

  /** Subscribes to a host event. Returns an unsubscribe function. */
  on<E extends EventName>(event: E, handler: (payload: Events[E]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as (payload: never) => void);
    this.listeners.set(event, set);

    return () => {
      set.delete(handler as (payload: never) => void);
    };
  }

  private post(message: WebviewMessage): void {
    this.api.postMessage(message);
  }

  private receive(message: HostMessage): void {
    if (!message || typeof message !== 'object') return;

    if (message.kind === 'event') {
      const handlers = this.listeners.get(message.event);
      if (!handlers) return;
      for (const handler of handlers) (handler as (payload: unknown) => void)(message.payload);
      return;
    }

    if (message.kind === 'response') {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);

      if (message.ok) entry.resolve(message.result);
      else entry.reject(new RpcRequestError(message.error));
    }
  }
}

export const rpc = new RpcClient();
