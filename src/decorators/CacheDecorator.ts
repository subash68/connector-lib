import { ConnectorDecorator } from './ConnectorDecorator.js';
import type { IBaseConnector } from '../interfaces/IBaseConnector.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheDecoratorOptions {
  /** TTL for getBlockNumber results. Default: 2000ms (~1 block on most chains). */
  blockNumberTtlMs?: number;
  /** TTL for getBalance results keyed by address. Default: 10000ms. */
  balanceTtlMs?: number;
}

export class CacheDecorator extends ConnectorDecorator {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly blockNumberTtl: number;
  private readonly balanceTtl: number;

  constructor(wrapped: IBaseConnector, options: CacheDecoratorOptions = {}) {
    super(wrapped);
    this.blockNumberTtl = options.blockNumberTtlMs ?? 2_000;
    this.balanceTtl = options.balanceTtlMs ?? 10_000;
  }

  override getBlockNumber(): Promise<bigint> {
    return this.withCache('blockNumber', this.blockNumberTtl, () =>
      super.getBlockNumber()
    );
  }

  override getBalance(address: string): Promise<bigint> {
    return this.withCache(`balance:${address}`, this.balanceTtl, () =>
      super.getBalance(address)
    );
  }

  /** Invalidate a specific cache key or the entire cache if no key is provided. */
  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  private async withCache<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>
  ): Promise<T> {
    const now = Date.now();
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (entry && entry.expiresAt > now) return entry.value;

    const value = await fn();
    this.cache.set(key, { value, expiresAt: now + ttlMs });
    return value;
  }
}
