import type { Address, Hex } from 'viem';

// ── Network ───────────────────────────────────────────────────────────────────

export type NetworkType = 'evm' | 'solana' | 'node';

export interface NetworkConfig {
  chainId: number;
  networkName: string;
  rpcUrl: string;
  nativeCurrency?: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

// ── Connector config ──────────────────────────────────────────────────────────

export interface ConnectorConfig {
  networkConfig: NetworkConfig;
  maxRetries?: number;
  retryDelay?: number;
  concurrency?: number;
  timeout?: number;
}

export interface NodeProviderConfig extends ConnectorConfig {
  maxRetries: number;
  retryDelay: number;
  concurrency: number;
}

// ── Transactions ──────────────────────────────────────────────────────────────

export interface TransactionResponse {
  hash: string;
  blockNumber: bigint | null;
  from: string;
  to: string | null;
  value: bigint;
  gasUsed?: bigint;
  status: 'success' | 'reverted' | 'pending' | 'unknown';
  raw: unknown;
}

export interface TransactionReceiptResponse {
  hash: string;
  blockNumber: bigint;
  from: string;
  to: string | null;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  status: 'success' | 'reverted';
  logs: LogResponse[];
  raw: unknown;
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export interface LogFilter {
  fromBlock?: bigint | 'latest' | 'earliest';
  toBlock?: bigint | 'latest';
  address?: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
}

export interface LogResponse {
  address: string;
  topics: string[];
  data: string;
  blockNumber: bigint | null;
  transactionHash: string | null;
  logIndex: number | null;
}

// ── Contract calls ────────────────────────────────────────────────────────────

export interface ContractCallParams {
  address: Address;
  abi: unknown[];
  functionName: string;
  args?: unknown[];
  value?: bigint;
}

export interface GasEstimateParams {
  address: Address;
  data?: Hex;
  value?: bigint;
}

// ── ERC-20 ────────────────────────────────────────────────────────────────────

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface TokenBalanceResult {
  tokenInfo: TokenInfo;
  balance: bigint;
  formattedBalance: string;
}

// ── Solana ────────────────────────────────────────────────────────────────────

export interface SolanaAccountInfo {
  pubkey: string;
  lamports: bigint;
  owner: string;
  executable: boolean;
  data: Uint8Array;
}
