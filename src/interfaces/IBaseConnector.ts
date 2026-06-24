export interface IBaseConnector {
  readonly chainId: number;
  readonly networkName: string;
  readonly rpcUrl: string;

  isConnected(): boolean;

  /** Initialise the underlying provider/client. Idempotent — safe to call multiple times. */
  connect(): Promise<void>;

  /** Release all resources. Idempotent. */
  disconnect(): Promise<void>;

  /** Returns the most recent confirmed block/slot number. */
  getBlockNumber(): Promise<bigint>;

  /**
   * Returns the native balance of an address.
   * EVM: balance in wei. Solana: balance in lamports.
   */
  getBalance(address: string): Promise<bigint>;
}
