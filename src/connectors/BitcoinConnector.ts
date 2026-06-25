import { NodeProviderBase } from './NodeProviderBase.js';
import type { IUtxoReader } from '../interfaces/IUtxoReader.js';
import type { NodeProviderConfig, Utxo } from '../types/index.js';
import { UnsupportedOperationError } from '../errors/index.js';

export type BitcoinBackend = 'core' | 'esplora' | 'electrum';

export interface BitcoinConnectorConfig extends NodeProviderConfig {
  /**
   * 'core'     — Bitcoin Core JSON-RPC. rpcUrl format: http://user:pass@host:port
   *              Requires -txindex or a descriptor/watch wallet for UTXO enumeration.
   * 'esplora'  — Esplora REST API (Blockstream / mempool.space compatible).
   *              rpcUrl is the API base, e.g. https://blockstream.info/api
   * 'electrum' — Electrum protocol. Not supported in v1; throws UnsupportedOperationError.
   */
  backend: BitcoinBackend;
}

export class BitcoinConnector extends NodeProviderBase implements IUtxoReader {
  private readonly backend: BitcoinBackend;

  constructor(config: BitcoinConnectorConfig) {
    super(config);
    this.backend = config.backend;
  }

  protected override async doConnect(): Promise<void> {
    // Verify connectivity — wrapped in ConnectionError by BaseConnector.connect()
    await this.doGetBlockNumber();
  }

  protected override async doDisconnect(): Promise<void> {
    // stateless HTTP — nothing to close
  }

  protected override async doGetBlockNumber(): Promise<bigint> {
    if (this.backend === 'core') {
      const height = await this.withRetry(() =>
        this.coreRpcCall<number>('getblockcount', [])
      );
      return BigInt(height);
    }
    if (this.backend === 'esplora') {
      const height = await this.withRetry(() =>
        this.esploraGet<number>('blocks/tip/height')
      );
      return BigInt(height);
    }
    throw new UnsupportedOperationError('getBlockNumber', 'BitcoinConnector');
  }

  protected override async doGetBalance(address: string): Promise<bigint> {
    // Balance is derived — Bitcoin has no account-balance RPC.
    const utxos = await this.getUtxos(address);
    return utxos.reduce((sum, u) => sum + u.value, 0n);
  }

  // ── IUtxoReader ─────────────────────────────────────────────────────────────

  async getUtxos(address: string): Promise<Utxo[]> {
    this.assertConnected();
    if (this.backend === 'core') {
      return this.withRetry(() => this.coreGetUtxos(address));
    }
    if (this.backend === 'esplora') {
      return this.withRetry(() => this.esploraGetUtxos(address));
    }
    throw new UnsupportedOperationError('getUtxos', 'BitcoinConnector');
  }

  // ── Bitcoin-specific (not on IUtxoReader) ───────────────────────────────────

  async getTransaction(txid: string): Promise<unknown> {
    this.assertConnected();
    if (this.backend === 'core') {
      return this.withRetry(() =>
        this.coreRpcCall<unknown>('getrawtransaction', [txid, true])
      );
    }
    if (this.backend === 'esplora') {
      return this.withRetry(() => this.esploraGet<unknown>(`tx/${txid}`));
    }
    throw new UnsupportedOperationError('getTransaction', 'BitcoinConnector');
  }

  /**
   * Returns the estimated fee in satoshis per virtual byte (sat/vB) for
   * confirmation within `targetBlocks` blocks.
   */
  async getFeeEstimate(targetBlocks: number): Promise<bigint> {
    this.assertConnected();
    if (this.backend === 'core') {
      const result = await this.withRetry(() =>
        this.coreRpcCall<{ feerate?: number }>('estimatesmartfee', [targetBlocks])
      );
      if (result.feerate === undefined) {
        throw new Error('estimatesmartfee: insufficient data for fee estimation');
      }
      // feerate is BTC/kB — convert: BTC/kB × 1e8 sat/BTC ÷ 1000 B/kB = 1e5 sat/B
      return BigInt(Math.ceil(result.feerate * 1e5));
    }
    if (this.backend === 'esplora') {
      // {"1": sat_per_vb, "3": sat_per_vb, ...} — pick closest or fall back to "6"
      const fees = await this.withRetry(() =>
        this.esploraGet<Record<string, number>>('fee-estimates')
      );
      const fee = fees[String(targetBlocks)] ?? fees['6'];
      if (fee === undefined) throw new Error('Fee estimate unavailable for target blocks');
      return BigInt(Math.ceil(fee));
    }
    throw new UnsupportedOperationError('getFeeEstimate', 'BitcoinConnector');
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async coreGetUtxos(address: string): Promise<Utxo[]> {
    type ScanResult = {
      unspents: Array<{
        txid: string;
        vout: number;
        scriptPubKey: string;
        amount: number;   // BTC float — convert to satoshis with btcToSats()
        height: number;
      }>;
    };
    const result = await this.coreRpcCall<ScanResult>('scantxoutset', [
      'start',
      [{ desc: `addr(${address})` }],
    ]);
    return result.unspents.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      value: btcToSats(u.amount),
      scriptPubKey: u.scriptPubKey,
      confirmations: -1,  // scantxoutset does not return confirmation count
    }));
  }

  private async esploraGetUtxos(address: string): Promise<Utxo[]> {
    type EsploraUtxo = {
      txid: string;
      vout: number;
      status: { confirmed: boolean };
      value: number;  // satoshis integer from Esplora
    };
    const utxos = await this.esploraGet<EsploraUtxo[]>(`address/${address}/utxo`);
    return utxos.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      value: BigInt(u.value),
      scriptPubKey: '',   // Esplora /address/{addr}/utxo does not include scriptPubKey
      confirmations: u.status.confirmed ? 1 : 0,
    }));
  }

  /**
   * Bitcoin Core JSON-RPC call (JSON-RPC 1.0) with Basic Auth.
   * Extracts credentials from the rpcUrl: http://user:pass@host:port
   */
  private async coreRpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const url = new URL(this.rpcUrl);
    const endpoint = `${url.protocol}//${url.host}${url.pathname}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (url.username) {
      headers['Authorization'] = `Basic ${btoa(`${url.username}:${url.password}`)}`;
    }

    const body = JSON.stringify({ jsonrpc: '1.0', id: Date.now(), method, params });
    const timeoutMs = this.config.timeout ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = (await res.json()) as { result?: T; error?: { message: string } };
      if (json.error) throw new Error(`RPC error: ${json.error.message}`);
      return json.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Esplora REST GET request.
   * rpcUrl is the Esplora base URL, e.g. https://blockstream.info/api
   */
  private async esploraGet<T>(path: string): Promise<T> {
    const base = this.rpcUrl.replace(/\/$/, '');
    const url = `${base}/${path}`;
    const timeoutMs = this.config.timeout ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Convert BTC float to satoshis. Rounds to avoid float imprecision. */
function btcToSats(btc: number): bigint {
  return BigInt(Math.round(btc * 1e8));
}
