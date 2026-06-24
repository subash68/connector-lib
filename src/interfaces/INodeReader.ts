export interface INodeReader {
  /** Returns the most recent confirmed block/slot number. */
  getBlockNumber(): Promise<bigint>;

  /**
   * Returns the native balance of an address.
   * EVM: balance in wei (bigint). Solana: balance in lamports (bigint).
   */
  getBalance(address: string): Promise<bigint>;
}
