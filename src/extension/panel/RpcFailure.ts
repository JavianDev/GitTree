import type { RpcError } from '@shared/protocol';

/** An error with an RPC code already attached. */
export class RpcFailure extends Error {
  constructor(
    readonly code: RpcError['code'],
    message: string,
  ) {
    super(message);
  }
}
