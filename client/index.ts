import { EVMConnector, LoggingDecorator, RetryDecorator } from "connector-lib";
import { formatEther } from "viem";

const nodeProviderUrl = process.env.POLYGON_RPC_URL;
const address =
  process.env.WALLET_ADDRESS ?? "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth fallback

if (!nodeProviderUrl) {
  console.error("Error: POLYGON_RPC_URL environment variable is required.");
  process.exit(1);
}

async function readPolBalance(): Promise<bigint> {
  const connector = new EVMConnector({
    networkConfig: {
      chainId: 137, // Polygon mainnet (Amoy testnet = 80002)
      networkName: "polygon",
      rpcUrl: nodeProviderUrl!,
    },
    maxRetries: 3,
    retryDelay: 300,
    concurrency: 8,
  });

  // Wrap with decorators for resilience + observability
  const client = new RetryDecorator(new LoggingDecorator(connector));

  await client.connect();
  try {
    const balanceWei = await client.getBalance(address); // POL in wei (18 decimals)
    return balanceWei;
  } finally {
    await client.disconnect();
  }
}

readPolBalance()
  .then((balanceWei) => {
    console.log(`\nAddress : ${address}`);
    console.log(`Network : Polygon mainnet (chainId 137)`);
    console.log(`Balance : ${formatEther(balanceWei)} POL`);
    console.log(`        (${balanceWei.toString()} wei)`);
  })
  .catch((err) => {
    console.error("Failed to read balance:", err);
    process.exit(1);
  });
