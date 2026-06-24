import { SolanaConnector, LoggingDecorator } from 'connector-lib';

// Client-supplied inputs
const nodeProviderUrl = process.env.SOLANA_RPC_URL;
const owner = process.env.WALLET_ADDRESS ?? 'vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg'; // example wallet
const mint = process.env.TOKEN_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC mint

if (!nodeProviderUrl) {
  console.error('Error: SOLANA_RPC_URL environment variable is required.');
  process.exit(1);
}

async function readSplBalance() {
  const connector = new SolanaConnector({
    networkConfig: {
      chainId: 101,                    // Solana mainnet-beta convention (102=testnet, 103=devnet)
      networkName: 'solana-mainnet',
      rpcUrl: nodeProviderUrl!,
    },
    commitment: 'confirmed',
    maxRetries: 3,
    retryDelay: 300,
    concurrency: 8,
  });

  // ISplTokenReader is on the concrete connector, not on IBaseConnector,
  // so lifecycle decorators wrap the base methods while token reads go directly.
  const lifecycle = new LoggingDecorator(connector);
  await lifecycle.connect();
  try {
    const { amount, decimals, uiAmount } = await connector.getSplTokenBalance(owner, mint);
    return { raw: amount, decimals, uiAmount };
  } finally {
    await lifecycle.disconnect();
  }
}

readSplBalance()
  .then(({ raw, decimals, uiAmount }) => {
    console.log(`\nOwner   : ${owner}`);
    console.log(`Mint    : ${mint}`);
    console.log(`Network : Solana mainnet-beta`);
    console.log(`Balance : ${uiAmount ?? Number(raw) / 10 ** decimals} (decimals: ${decimals})`);
    console.log(`        (${raw.toString()} raw units)`);
  })
  .catch((err) => {
    console.error('Failed to read SPL balance:', err);
    process.exit(1);
  });
