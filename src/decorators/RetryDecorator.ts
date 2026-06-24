import { ConnectorDecorator } from "./ConnectorDecorator";
import type { IBaseConnector } from "../interfaces/IBaseConnector";
import { RetryExhaustedError } from "../errors/index";

export interface RetryDecoratorOptions {
  maxRetries?: number;
  retryDelay?: number;
}

export class RetryDecorator extends ConnectorDecorator {
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(wrapped: IBaseConnector, options: RetryDecoratorOptions = {}) {
    super(wrapped);
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelay = options.retryDelay ?? 300;
  }

  override getBlockNumber(): Promise<bigint> {
    return this.withRetry(() => super.getBlockNumber());
  }

  override getBalance(address: string): Promise<bigint> {
    return this.withRetry(() => super.getBalance(address));
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        await new Promise((res) =>
          setTimeout(res, this.retryDelay * Math.pow(2, i)),
        );
      }
    }
    throw new RetryExhaustedError(this.maxRetries, lastErr);
  }
}
