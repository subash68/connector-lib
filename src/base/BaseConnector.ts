import type { IConnectionManager } from '../interfaces/IConnectionManager.js';
import type { ConnectorConfig, NetworkConfig } from '../types/index.js';
import { ConnectionError, NotConnectedError } from '../errors/index.js';

export abstract class BaseConnector implements IConnectionManager {
  protected readonly config: ConnectorConfig;
  protected readonly network: NetworkConfig;
  private _connected = false;

  constructor(config: ConnectorConfig) {
    this.config = config;
    this.network = config.networkConfig;
  }

  get chainId(): number {
    return this.network.chainId;
  }

  get networkName(): string {
    return this.network.networkName;
  }

  get rpcUrl(): string {
    return this.network.rpcUrl;
  }

  isConnected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this._connected) return;
    try {
      await this.doConnect();
      this._connected = true;
    } catch (err) {
      throw new ConnectionError(this.rpcUrl, err);
    }
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    await this.doDisconnect();
    this._connected = false;
  }

  protected abstract doConnect(): Promise<void>;
  protected abstract doDisconnect(): Promise<void>;

  protected assertConnected(): void {
    if (!this._connected) throw new NotConnectedError();
  }
}
