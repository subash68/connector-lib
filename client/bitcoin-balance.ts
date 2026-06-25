import { BitcoinConnector, LoggingDecorator, type BitcoinBackend } from 'connector-lib';

// ── Client-supplied inputs ────────────────────────────────────────────────────
//
// Esplora (default):
//   BITCOIN_RPC_URL=https://blockstream.info/api
//   BITCOIN_ADDRESS=<any Bitcoin address>
//
// Bitcoin Core:
//   BITCOIN_RPC_URL=http://user:password@127.0.0.1:8332
//   BITCOIN_BACKEND=core
//   BITCOIN_ADDRESS=<address indexed by your node>

const rpcUrl = process.env.BITCOIN_RPC_URL ?? 'https://blockstream.info/api';
const backend = (process.env.BITCOIN_BACKEND ?? 'esplora') as BitcoinBackend;
const address =
  process.env.BITCOIN_ADDRESS ??
  '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf2a'; // Satoshi's genesis coinbase (fallback demo)

// ─────────────────────────────────────────────────────────────────────────────

function formatBtc(satoshis: bigint): string {
  // Avoid float imprecision: format integer satoshis into BTC string manually.
  const abs = satoshis < 0n ? -satoshis : satoshis;
  const sign = satoshis < 0n ? '-' : '';
  const satsStr = abs.toString().padStart(9, '0');
  const whole = satsStr.slice(0, -8) || '0';
  const frac = satsStr.slice(-8);
  return `${sign}${whole}.${frac}`;
}

async function run() {
  const connector = new BitcoinConnector({
    networkConfig: {
      chainId: 0,            // Bitcoin has no numeric chain ID — 0 by convention
      networkName: 'bitcoin-mainnet',
      rpcUrl,
    },
    backend,
    maxRetries: 3,
    retryDelay: 300,
    concurrency: 4,
  });

  // IBaseConnector methods (getBlockNumber, getBalance, connect, disconnect) are
  // available on the decorated instance. Bitcoin-specific methods (getUtxos,
  // getFeeEstimate, getTransaction) are on the concrete connector directly.
  const client = new LoggingDecorator(connector);

  await client.connect();
  try {
    const [blockHeight, balanceSats, utxos, feeSats] = await Promise.all([
      client.getBlockNumber(),
      client.getBalance(address),           // derived: sum of UTXOs in satoshis
      connector.getUtxos(address),          // concrete connector — not on IBaseConnector
      connector.getFeeEstimate(6),          // ~1 hour target, sat/vB
    ]);

    console.log('\n─── Bitcoin Balance ──────────────────────────────────────────');
    console.log(`Address      : ${address}`);
    console.log(`Network      : Bitcoin mainnet (backend: ${backend})`);
    console.log(`Block height : ${blockHeight.toLocaleString()}`);
    console.log(`Balance      : ${formatBtc(balanceSats)} BTC`);
    console.log(`             (${balanceSats.toLocaleString()} satoshis)`);
    console.log(`Fee estimate : ${feeSats} sat/vB  (6-block target)`);

    if (utxos.length === 0) {
      console.log('\nNo UTXOs found for this address.');
    } else {
      console.log(`\n─── UTXOs (${utxos.length}) ────────────────────────────────────────`);
      for (const utxo of utxos) {
        const conf =
          utxo.confirmations === -1
            ? 'confirmed (count N/A via Core scantxoutset)'
            : utxo.confirmations === 0
              ? 'unconfirmed'
              : `${utxo.confirmations}+ confirmations`;
        console.log(`  ${utxo.txid}:${utxo.vout}  ${formatBtc(utxo.value)} BTC  [${conf}]`);
      }
    }
    console.log('──────────────────────────────────────────────────────────────\n');
  } finally {
    await client.disconnect();
  }
}

run().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
