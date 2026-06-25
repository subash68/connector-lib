import type { INodeReader } from './INodeReader.js';
import type { Utxo } from '../types/index.js';

/**
 * UTXO-model chain reads. Extends INodeReader because a Bitcoin node IS a node
 * reader — getBlockNumber maps to block height and getBalance is derived as the
 * sum of getUtxos(address) values (in satoshis). Contrast with ITokenReader /
 * ISplTokenReader which are purely additive and have no relationship to INodeReader.
 */
export interface IUtxoReader extends INodeReader {
  getUtxos(address: string): Promise<Utxo[]>;
}
