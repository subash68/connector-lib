import { Connection, PublicKey } from '@solana/web3.js';
import { NodeProviderBase } from './NodeProviderBase.js';
import type { ISplTokenReader } from '../interfaces/ISplTokenReader.js';
import type {
  NodeProviderConfig,
  TransactionResponse,
  SolanaAccountInfo,
  TokenAmount,
  SplTokenAccount,
} from '../types/index.js';

export interface SolanaConnectorConfig extends NodeProviderConfig {
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

export class SolanaConnector extends NodeProviderBase implements ISplTokenReader {
  private connection!: Connection;
  private readonly commitment: 'processed' | 'confirmed' | 'finalized';

  constructor(config: SolanaConnectorConfig) {
    super(config);
    this.commitment = config.commitment ?? 'confirmed';
  }

  protected override async doConnect(): Promise<void> {
    this.connection = new Connection(this.rpcUrl, { commitment: this.commitment });
    await this.connection.getSlot();
  }

  protected override async doDisconnect(): Promise<void> {
    // stateless HTTP — nothing to close
  }

  protected override async doGetBlockNumber(): Promise<bigint> {
    const slot = await this.withRetry(() => this.connection.getSlot(this.commitment));
    return BigInt(slot);
  }

  protected override async doGetBalance(address: string): Promise<bigint> {
    const pubkey = new PublicKey(address);
    const lamports = await this.withRetry(() => this.connection.getBalance(pubkey));
    return BigInt(lamports);
  }

  // ── Solana-specific methods ─────────────────────────────────────────────────

  async getSlot(): Promise<bigint> {
    this.assertConnected();
    const slot = await this.withRetry(() => this.connection.getSlot(this.commitment));
    return BigInt(slot);
  }

  async getTransaction(signature: string): Promise<TransactionResponse | null> {
    this.assertConnected();
    const tx = await this.withRetry(() =>
      this.connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })
    );
    if (!tx) return null;

    return {
      hash: signature,
      blockNumber: tx.slot ? BigInt(tx.slot) : null,
      from: tx.transaction.message.accountKeys[0]?.pubkey.toBase58() ?? '',
      to: tx.transaction.message.accountKeys[1]?.pubkey.toBase58() ?? null,
      value: BigInt(0),
      gasUsed: BigInt(tx.meta?.fee ?? 0),
      status: tx.meta?.err ? 'reverted' : 'success',
      raw: tx,
    };
  }

  async getAccountInfo(address: string): Promise<SolanaAccountInfo | null> {
    this.assertConnected();
    const pubkey = new PublicKey(address);
    const info = await this.withRetry(() => this.connection.getAccountInfo(pubkey));
    if (!info) return null;
    return {
      pubkey: address,
      lamports: BigInt(info.lamports),
      owner: info.owner.toBase58(),
      executable: info.executable,
      data: new Uint8Array(info.data),
    };
  }

  // ── ISplTokenReader ─────────────────────────────────────────────────────────

  private static readonly TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

  async getSplTokenBalance(owner: string, mint: string): Promise<TokenAmount> {
    this.assertConnected();
    const accounts = await this.withRetry(() =>
      this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(owner),
        { mint: new PublicKey(mint) }
      )
    );

    if (accounts.value.length === 0) {
      return { amount: 0n, decimals: 0, uiAmount: 0 };
    }

    const parsed = this.parsedTokenInfo(accounts.value[0].account.data.parsed);
    return {
      amount: BigInt(parsed.tokenAmount.amount),
      decimals: parsed.tokenAmount.decimals,
      uiAmount: parsed.tokenAmount.uiAmount,
    };
  }

  async getSplTokenAccounts(owner: string): Promise<SplTokenAccount[]> {
    this.assertConnected();
    const accounts = await this.withRetry(() =>
      this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(owner),
        { programId: new PublicKey(SolanaConnector.TOKEN_PROGRAM_ID) }
      )
    );

    return accounts.value.map((acc) => {
      const parsed = this.parsedTokenInfo(acc.account.data.parsed);
      return {
        pubkey: acc.pubkey.toBase58(),
        mint: parsed.mint,
        amount: {
          amount: BigInt(parsed.tokenAmount.amount),
          decimals: parsed.tokenAmount.decimals,
          uiAmount: parsed.tokenAmount.uiAmount,
        },
      };
    });
  }

  private parsedTokenInfo(parsed: unknown): {
    mint: string;
    tokenAmount: { amount: string; decimals: number; uiAmount: number | null };
  } {
    return (parsed as { info: { mint: string; tokenAmount: { amount: string; decimals: number; uiAmount: number | null } } }).info;
  }

  // ── Legacy ─────────────────────────────────────────────────────────────────

  async getTokenAccountsByOwner(
    ownerAddress: string,
    filter: { mint?: string; programId?: string }
  ): Promise<Array<{ pubkey: string; mint: string; amount: bigint }>> {
    this.assertConnected();
    const owner = new PublicKey(ownerAddress);
    const solanaFilter = filter.mint
      ? { mint: new PublicKey(filter.mint) }
      : {
          programId: new PublicKey(
            filter.programId ?? 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
          ),
        };

    const accounts = await this.withRetry(() =>
      this.connection.getParsedTokenAccountsByOwner(owner, solanaFilter)
    );

    return accounts.value.map((acc) => {
      const info = (acc.account.data.parsed as { info: { mint: string; tokenAmount: { amount: string } } }).info;
      return {
        pubkey: acc.pubkey.toBase58(),
        mint: info.mint,
        amount: BigInt(info.tokenAmount.amount),
      };
    });
  }
}
