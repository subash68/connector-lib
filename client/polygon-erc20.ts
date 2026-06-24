import { EVMConnector, LoggingDecorator, RetryDecorator } from 'connector-lib';
import { formatUnits } from 'viem';

// Client-supplied inputs
const nodeProviderUrl = process.env.POLYGON_RPC_URL;
const usdc = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // USDC on Polygon (6 decimals)
const owner = process.env.WALLET_ADDRESS ?? '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

if (!nodeProviderUrl) {
  console.error('Error: POLYGON_RPC_URL environment variable is required.');
  process.exit(1);
}

async function readUsdcBalance(): Promise<bigint> {
  const connector = new EVMConnector({
    networkConfig: {
      chainId: 137,           // Polygon mainnet (Amoy testnet = 80002)
      networkName: 'polygon',
      rpcUrl: nodeProviderUrl!,
    },
    maxRetries: 3,
    retryDelay: 300,
    concurrency: 8,
  });

  // Lifecycle/native reads go through decorators; ITokenReader methods go to
  // the concrete connector directly (not exposed on IBaseConnector).
  const lifecycle = new RetryDecorator(new LoggingDecorator(connector));
  await lifecycle.connect();
  try {
    const raw = await connector.getErc20Balance(usdc, owner); // raw units, 6 decimals
    return raw;
  } finally {
    await lifecycle.disconnect();
  }
}

readUsdcBalance()
  .then((raw) => {
    const USDC_DECIMALS = 6;
    console.log(`\nOwner   : ${owner}`);
    console.log(`Token   : USDC (${usdc})`);
    console.log(`Network : Polygon mainnet (chainId 137)`);
    console.log(`Balance : ${formatUnits(raw, USDC_DECIMALS)} USDC`);
    console.log(`        (${raw.toString()} raw units)`);
  })
  .catch((err) => {
    console.error('Failed to read USDC balance:', err);
    process.exit(1);
  });
