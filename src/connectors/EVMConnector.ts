import {
  createPublicClient,
  http,
  parseAbi,
  formatUnits,
  getContract,
  type PublicClient,
  type Chain,
  type Address,
  type Hash,
  type Hex,
  type Log,
} from 'viem';
import { NodeProviderBase } from './NodeProviderBase.js';
import type { ITokenReader } from '../interfaces/ITokenReader.js';
import type {
  NodeProviderConfig,
  TransactionResponse,
  TransactionReceiptResponse,
  LogFilter,
  LogResponse,
  ContractCallParams,
  GasEstimateParams,
  TokenInfo,
  TokenBalanceResult,
} from '../types/index.js';
import { ContractCallError } from '../errors/index.js';

export interface EVMConnectorConfig extends NodeProviderConfig {
  /** Optional viem Chain object for typed chain definitions. Chain-agnostic if omitted. */
  viemChain?: Chain;
}

export class EVMConnector extends NodeProviderBase implements ITokenReader {
  private client!: PublicClient;
  private readonly viemChain?: Chain;

  constructor(config: EVMConnectorConfig) {
    super(config);
    this.viemChain = config.viemChain;
  }

  protected override async doConnect(): Promise<void> {
    this.client = createPublicClient({
      chain: this.viemChain,
      transport: http(this.rpcUrl, {
        timeout: this.config.timeout ?? 30_000,
        retryCount: 0, // inherited withRetry handles retries — avoid double-retry
      }),
    }) as PublicClient;

    const [, actualChainId] = await Promise.all([
      this.client.getBlockNumber(),
      this.client.getChainId(),
    ]);

    if (actualChainId !== this.chainId) {
      throw new Error(
        `Chain ID mismatch: declared ${this.chainId} but RPC returned ${actualChainId}`
      );
    }
  }

  protected override async doDisconnect(): Promise<void> {
    // viem PublicClient is stateless — nothing to close
  }

  protected override async doGetBlockNumber(): Promise<bigint> {
    return this.withRetry(() => this.client.getBlockNumber());
  }

  protected override async doGetBalance(address: string): Promise<bigint> {
    return this.withRetry(() =>
      this.client.getBalance({ address: address as Address })
    );
  }

  // ── Transactions ────────────────────────────────────────────────────────────

  async getTransaction(hash: Hash): Promise<TransactionResponse> {
    this.assertConnected();
    const tx = await this.withRetry(() => this.client.getTransaction({ hash }));
    return {
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      from: tx.from,
      to: tx.to ?? null,
      value: tx.value,
      status: tx.blockNumber ? 'success' : 'pending',
      raw: tx,
    };
  }

  async getTransactionReceipt(hash: Hash): Promise<TransactionReceiptResponse> {
    this.assertConnected();
    const receipt = await this.withRetry(() =>
      this.client.getTransactionReceipt({ hash })
    );
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      from: receipt.from,
      to: receipt.to ?? null,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      status: receipt.status === 'success' ? 'success' : 'reverted',
      logs: receipt.logs.map(this.mapLog),
      raw: receipt,
    };
  }

  async getGasPrice(): Promise<bigint> {
    this.assertConnected();
    return this.withRetry(() => this.client.getGasPrice());
  }

  async estimateGas(params: GasEstimateParams): Promise<bigint> {
    this.assertConnected();
    return this.withRetry(() =>
      this.client.estimateGas({ to: params.address, data: params.data, value: params.value })
    );
  }

  async callContract(params: ContractCallParams): Promise<unknown> {
    this.assertConnected();
    try {
      return await this.withRetry(() =>
        this.client.readContract({
          address: params.address,
          abi: params.abi as readonly unknown[],
          functionName: params.functionName,
          args: params.args ?? [],
        })
      );
    } catch (err) {
      throw new ContractCallError(params.address, params.functionName, err);
    }
  }

  async getLogs(filter: LogFilter): Promise<LogResponse[]> {
    this.assertConnected();
    const logs = await this.withRetry(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client.getLogs(filter as any)
    );
    return logs.map(this.mapLog);
  }

  async getCode(address: Address): Promise<Hex> {
    this.assertConnected();
    return this.withRetry(async () => (await this.client.getCode({ address })) ?? '0x');
  }

  async getNonce(address: Address): Promise<number> {
    this.assertConnected();
    return this.withRetry(() => this.client.getTransactionCount({ address }));
  }

  // ── ERC-20 helpers ──────────────────────────────────────────────────────────

  private static readonly ERC20_ABI = parseAbi([
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address) view returns (uint256)',
  ]);

  async getTokenMetadata(tokenAddress: Address): Promise<TokenInfo> {
    this.assertConnected();
    try {
      const contract = getContract({
        address: tokenAddress,
        abi: EVMConnector.ERC20_ABI,
        client: this.client,
      });
      const [name, symbol, decimals] = await Promise.all([
        contract.read.name(),
        contract.read.symbol(),
        contract.read.decimals(),
      ]);
      return { address: tokenAddress, name, symbol, decimals };
    } catch (err) {
      throw new ContractCallError(tokenAddress, 'ERC20 metadata', err);
    }
  }

  async getTokenBalance(
    tokenAddress: Address,
    holderAddress: Address
  ): Promise<TokenBalanceResult> {
    this.assertConnected();
    const meta = await this.getTokenMetadata(tokenAddress);
    const contract = getContract({
      address: tokenAddress,
      abi: EVMConnector.ERC20_ABI,
      client: this.client,
    });
    const balance = await contract.read.balanceOf([holderAddress]);
    return {
      tokenInfo: meta,
      balance,
      formattedBalance: formatUnits(balance, meta.decimals),
    };
  }

  // ── ITokenReader ────────────────────────────────────────────────────────────

  private static readonly ERC721_ABI = parseAbi([
    'function ownerOf(uint256) view returns (address)',
    'function balanceOf(address) view returns (uint256)',
  ]);

  private static readonly ERC1155_ABI = parseAbi([
    'function balanceOf(address, uint256) view returns (uint256)',
  ]);

  async getErc20Balance(token: string, owner: string): Promise<bigint> {
    this.assertConnected();
    try {
      const contract = getContract({
        address: token as Address,
        abi: EVMConnector.ERC20_ABI,
        client: this.client,
      });
      return await this.withRetry(() => contract.read.balanceOf([owner as Address]));
    } catch (err) {
      throw new ContractCallError(token, 'ERC20.balanceOf', err);
    }
  }

  async getErc721Owner(token: string, tokenId: bigint): Promise<string> {
    this.assertConnected();
    try {
      const contract = getContract({
        address: token as Address,
        abi: EVMConnector.ERC721_ABI,
        client: this.client,
      });
      return await this.withRetry(() => contract.read.ownerOf([tokenId]));
    } catch (err) {
      throw new ContractCallError(token, 'ERC721.ownerOf', err);
    }
  }

  async getErc721Balance(token: string, owner: string): Promise<bigint> {
    this.assertConnected();
    try {
      const contract = getContract({
        address: token as Address,
        abi: EVMConnector.ERC721_ABI,
        client: this.client,
      });
      return await this.withRetry(() => contract.read.balanceOf([owner as Address]));
    } catch (err) {
      throw new ContractCallError(token, 'ERC721.balanceOf', err);
    }
  }

  async getErc1155Balance(token: string, owner: string, tokenId: bigint): Promise<bigint> {
    this.assertConnected();
    try {
      const contract = getContract({
        address: token as Address,
        abi: EVMConnector.ERC1155_ABI,
        client: this.client,
      });
      return await this.withRetry(() => contract.read.balanceOf([owner as Address, tokenId]));
    } catch (err) {
      throw new ContractCallError(token, 'ERC1155.balanceOf', err);
    }
  }

  // ── Private utils ───────────────────────────────────────────────────────────

  private mapLog(log: Log): LogResponse {
    return {
      address: log.address,
      topics: log.topics as string[],
      data: log.data,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
    };
  }
}
