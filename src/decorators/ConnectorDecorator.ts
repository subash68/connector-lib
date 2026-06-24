import type { IBaseConnector } from "../interfaces/IBaseConnector";

/**
 * Abstract GoF Decorator base. Implements IBaseConnector by forwarding
 * all calls to the wrapped connector. Concrete decorators override only
 * the methods they need to intercept.
 */
export abstract class ConnectorDecorator implements IBaseConnector {
  constructor(protected readonly wrapped: IBaseConnector) {}

  get chainId(): number {
    return this.wrapped.chainId;
  }

  get networkName(): string {
    return this.wrapped.networkName;
  }

  get rpcUrl(): string {
    return this.wrapped.rpcUrl;
  }

  isConnected(): boolean {
    return this.wrapped.isConnected();
  }

  connect(): Promise<void> {
    return this.wrapped.connect();
  }

  disconnect(): Promise<void> {
    return this.wrapped.disconnect();
  }

  getBlockNumber(): Promise<bigint> {
    return this.wrapped.getBlockNumber();
  }

  getBalance(address: string): Promise<bigint> {
    return this.wrapped.getBalance(address);
  }
}
