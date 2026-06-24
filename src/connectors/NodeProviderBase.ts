import pLimit, { type LimitFunction } from 'p-limit';
import { BaseConnector } from '../base/BaseConnector.js';
import type { INodeReader } from '../interfaces/INodeReader.js';
import type { NodeProviderConfig } from '../types/index.js';
import { RetryExhaustedError } from '../errors/index.js';

export abstract class NodeProviderBase extends BaseConnector implements INodeReader {
  protected readonly maxRetries: number;
  protected readonly retryDelay: number;
  protected readonly limiter: LimitFunction;

  constructor(config: NodeProviderConfig) {
    super(config);
    this.maxRetries = config.maxRetries;
    this.retryDelay = config.retryDelay;
    this.limiter = pLimit(config.concurrency);
  }

  async getBlockNumber(): Promise<bigint> {
    this.assertConnected();
    return this.doGetBlockNumber();
  }

  async getBalance(address: string): Promise<bigint> {
    this.assertConnected();
    return this.doGetBalance(address);
  }

  protected override async doConnect(): Promise<void> {
    await this.rpcCall<string>('eth_blockNumber', []);
  }

  protected override async doDisconnect(): Promise<void> {
    // stateless HTTP — nothing to close
  }

  protected async doGetBlockNumber(): Promise<bigint> {
    const hex = await this.withRetry(() => this.rpcCall<string>('eth_blockNumber', []));
    return BigInt(hex);
  }

  protected async doGetBalance(address: string): Promise<bigint> {
    const hex = await this.withRetry(() =>
      this.rpcCall<string>('eth_getBalance', [address, 'latest'])
    );
    return BigInt(hex);
  }

  protected async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
    const timeoutMs = this.config.timeout ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = (await response.json()) as {
        result?: T;
        error?: { message: string };
      };

      if (json.error) throw new Error(`RPC error: ${json.error.message}`);
      return json.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  protected async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        return await this.limiter(fn);
      } catch (err) {
        lastErr = err;
        await new Promise((res) => setTimeout(res, this.retryDelay * Math.pow(2, i)));
      }
    }
    throw new RetryExhaustedError(this.maxRetries, lastErr);
  }
}
