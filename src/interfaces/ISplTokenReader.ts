import type { TokenAmount, SplTokenAccount } from '../types/index.js';

/**
 * Solana SPL token reads. Implemented only by SolanaConnector.
 * SPL amounts carry their own decimals (unlike EVM where decimals are a
 * separate contract call), so getSplTokenBalance returns TokenAmount rather
 * than a bare bigint.
 */
export interface ISplTokenReader {
  /**
   * Returns the SPL token balance for the given owner wallet and mint.
   * Returns a zero TokenAmount (amount: 0n) if the owner holds no account for the mint.
   */
  getSplTokenBalance(owner: string, mint: string): Promise<TokenAmount>;

  /** Lists all SPL token accounts owned by the wallet, each with mint + amount. */
  getSplTokenAccounts(owner: string): Promise<SplTokenAccount[]>;
}
