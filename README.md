# connector-lib

# Architecture & Implementation Plan

> **Note on design evolution:** Two refinements over the original draft UML. (1) `NodeProviderBase` becomes an **intermediate abstract base** between `BaseConnector` and the chain-specific connectors, so `EVMConnector` and `SolanaConnector` inherit shared retry/concurrency/RPC infrastructure. (2) The single `IBaseConnector` is split via **Interface Segregation** into `IConnectionManager` (lifecycle), `INodeReader` (generic node reads), and `ITokenReader` (EVM token reads) — connection management and node-data reading are distinct responsibilities, and token reading is an EVM-only capability that should not be forced onto `SolanaConnector`. The decorator pattern is implemented as a **GoF runtime decorator** (instance wrapping) rather than TypeScript decorators.

## Context

Greenfield TypeScript library providing typed blockchain connectors for EVM chains and Solana. The workspace already has `viem` ^2.38.0 and `ethers` ^6.15.0 in nearby projects, and uses `tsup` + TypeScript 5.x for library builds (matching the `custom-package` project pattern). The directory is currently empty.

---

## Architecture

### Class Hierarchy

```jsx
Interfaces (segregated)
  IConnectionManager   — connect / disconnect / isConnected
  INodeReader          — getBlockNumber / getBalance (native coin)
  ITokenReader         — ERC-20 / 721 / 1155 reads (EVM only, additive)
  ISplTokenReader      — SPL token reads (Solana only, additive)
  IUtxoReader          — extends INodeReader; UTXO reads + getBalance as UTXO sum (Bitcoin only)
  IBaseConnector       = IConnectionManager + INodeReader

IConnectionManager (interface)
    └── BaseConnector (abstract class)            — lifecycle only: connect/disconnect (doConnect/doDisconnect)
            └── NodeProviderBase (abstract class) — implements INodeReader; adds getBlockNumber/getBalance
                │                                   (doGetBlockNumber/doGetBalance hooks) + withRetry, p-limit, rpcCall
                    ├── EVMConnector (class)       — viem PublicClient; also implements ITokenReader
                    ├── SolanaConnector (class)    — @solana/web3.js; also implements ISplTokenReader
                    └── BitcoinConnector (class)   — Core JSON-RPC / indexer; implements IUtxoReader; backend mode

(BaseConnector + NodeProviderBase together satisfy IBaseConnector = IConnectionManager + INodeReader)

IBaseConnector (interface)
    └── ConnectorDecorator (abstract class)       — GoF Decorator base, wraps IBaseConnector
            ├── RetryDecorator                    — exponential backoff (3×, 300ms base)
            ├── LoggingDecorator                  — structured JSON logs per call
            └── CacheDecorator                    — TTL-keyed in-memory cache
    (EVMConnectorDecorator — optional, also implements ITokenReader for decorated token reads)
```

### Decorator Pattern Decision

**GoF Decorator** (instance wrapping). No `experimentalDecorators` flag needed, fully composable at runtime:

```tsx
new CacheDecorator(new RetryDecorator(new LoggingDecorator(evmConnector)));
```

Each decorator is independently unit-testable against a mock `IBaseConnector`. `ConnectorDecorator implements IBaseConnector` — Liskov-safe substitution everywhere.

### NodeProviderBase Role

**Intermediate abstract base.** Sits between `BaseConnector` and the chain-specific connectors. It is the layer that **implements `INodeReader`** (introducing `getBlockNumber` / `getBalance` and their `doGetBlockNumber()` / `doGetBalance()` hooks), and it provides shared infrastructure:

- `withRetry<T>()` — exponential backoff retry (3×, 300ms, 2× multiplier)
- `limiter` — p-limit concurrency guard (default: 8)
- `protected rpcCall<T>()` — raw JSON-RPC 2.0 via `fetch` (useful for Solana raw calls and EVM fallback)

`EVMConnector` overrides the read hooks (`doGetBlockNumber`/`doGetBalance`) using `viem`, but inherits retry/concurrency infra. `SolanaConnector` overrides them using `@solana/web3.js` and similarly inherits the infra. Lifecycle hooks (`doConnect`/`doDisconnect`) come from `BaseConnector`.

---

## File Structure

```jsx
connector-lib/
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── src/
    ├── index.ts                          # Public API barrel
    ├── types/index.ts                    # Shared types: ConnectorConfig, TransactionResponse, etc.
    ├── errors/index.ts                   # Typed error classes
    ├── interfaces/
    │   ├── IConnectionManager.ts     # Lifecycle: connect/disconnect/isConnected
    │   ├── INodeReader.ts            # Generic node reads: blockNumber, native balance
    │   ├── ITokenReader.ts           # EVM token reads: ERC-20/721/1155
    │   ├── ISplTokenReader.ts        # Solana token reads: SPL
    │   ├── IUtxoReader.ts            # Bitcoin: extends INodeReader, UTXO reads + derived balance
    │   └── IBaseConnector.ts         # Composed: IConnectionManager + INodeReader
    ├── base/BaseConnector.ts             # Abstract base with Template Method pattern
    ├── connectors/
    │   ├── NodeProviderBase.ts           # Abstract intermediate base: retry + p-limit + rpcCall
    │   ├── EVMConnector.ts               # viem-backed EVM connector
    │   ├── SolanaConnector.ts            # @solana/web3.js connector
    │   └── BitcoinConnector.ts           # Core JSON-RPC / indexer; IUtxoReader; backend mode
    └── decorators/
        ├── ConnectorDecorator.ts         # Abstract GoF decorator base
        ├── RetryDecorator.ts
        ├── LoggingDecorator.ts
        └── CacheDecorator.ts
```

---

## Key Design Decisions

### Interface Segregation

`BaseConnector`'s responsibility is **connection lifecycle**, not exposing node RPC methods. Reading data from a node (block number, balances, token balances) is a separate concern. Conflating both in one interface worked with two read methods but breaks down once token reads (ERC-20/721/1155) are added — and forcing token methods onto the shared base would make `SolanaConnector` stub or throw, violating ISP/Liskov. The interface is therefore split into three:

```tsx
// Lifecycle only — what BaseConnector is actually about
interface IConnectionManager {
  readonly chainId: number;
  readonly networkName: string;
  readonly rpcUrl: string;
  isConnected(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

// Generic node reads available on essentially any chain
interface INodeReader {
  getBlockNumber(): Promise<bigint>;
  getBalance(address: string): Promise<bigint>; // native coin: ETH, POL, etc.
}

// EVM token reads — a capability, not every connector has it
interface ITokenReader {
  getErc20Balance(token: string, owner: string): Promise<bigint>;
  getErc721Owner(token: string, tokenId: bigint): Promise<string>;
  getErc721Balance(token: string, owner: string): Promise<bigint>; // count of NFTs owned
  getErc1155Balance(
    token: string,
    owner: string,
    tokenId: bigint,
  ): Promise<bigint>;
}

// Solana token reads — parallel capability, SPL model (no 721/1155 equivalent)
interface ISplTokenReader {
  // owner = wallet address; mint = SPL token mint address
  getSplTokenBalance(owner: string, mint: string): Promise<TokenAmount>;
  getSplTokenAccounts(owner: string): Promise<SplTokenAccount[]>; // all token holdings
}

// Bitcoin reads — UTXO model. Unlike the token readers above, this EXTENDS
// INodeReader: a Bitcoin node IS a node reader, it just derives getBalance differently.
interface IUtxoReader extends INodeReader {
  getUtxos(address: string): Promise<Utxo[]>; // unspent outputs for address
  // getBlockNumber(): inherited — maps to block height (getblockcount)
  // getBalance(address): inherited — implemented as sum of getUtxos(address), in satoshis
}

// The composed interface clients usually consume
interface IBaseConnector extends IConnectionManager, INodeReader {}
```

Key consequences:

- **`IBaseConnector` = `IConnectionManager` + `INodeReader`** — lifecycle plus native reads. No single class implements it directly: `BaseConnector` implements `IConnectionManager`, `NodeProviderBase` adds `INodeReader`, so the concrete connectors satisfy the composed `IBaseConnector`. The generic decorator implements `IBaseConnector` as its wrapped type.
- **`ITokenReader` is implemented only by `EVMConnector`, `ISplTokenReader` only by `SolanaConnector`, `IUtxoReader` only by `BitcoinConnector`.** Each chain's token/value model is exposed as its own capability surface; none is forced onto the shared base. SPL amounts carry their own decimals — `getSplTokenBalance` returns a `TokenAmount` ({ amount: bigint (raw), decimals: number, uiAmount }) — because SPL mints define decimals per token. Native balances (`INodeReader.getBalance`) return raw integers in each chain's base unit: wei (10^18) on EVM, lamports (10^9) on Solana, satoshis (10^8) on Bitcoin.
- **`IUtxoReader` extends `INodeReader` — a different relationship from the token readers.** `ITokenReader` and `ISplTokenReader` are purely _additive_ (new methods, no relationship to `INodeReader`). `IUtxoReader` instead _inherits_ `INodeReader` and **refines** the meaning of its inherited `getBalance`: Bitcoin has no account-balance RPC, so `BitcoinConnector` implements `getBalance(address)` as the sum of `getUtxos(address)` values (in satoshis). This keeps polymorphism intact — code holding an `INodeReader` can still call `getBalance` against Bitcoin — while exposing the UTXO primitive to clients who want it. The derivation lives in one method implementation, declared by the interface rather than hidden.
- **Bitcoin needs a backend mode, orthogonal to the interface.** A bare Bitcoin Core node cannot enumerate UTXOs for an arbitrary address without `-txindex` or a descriptor watch. So `BitcoinConnector` takes a `backend` discriminated-union config: `'core'` (Bitcoin Core JSON-RPC, requires txindex/descriptors) or `'esplora'` / `'electrum'` (external indexer over HTTP). If the configured backend cannot enumerate address UTXOs, `getUtxos` / `getBalance` throw a typed `UnsupportedOperationError` rather than silently returning zero.
- **Naming guardrail:** `BaseConnector` is kept as the class name, but its honest responsibility is connection management (`IConnectionManager`) plus native reads (`INodeReader`). The "Base" name should not tempt contributors into piling further node-method interfaces onto it — the segregation is the guardrail.

### BaseConnector (Abstract)

- **Implements `IConnectionManager` only** — lifecycle, nothing else. Node reads live in `NodeProviderBase`.
- `_connected: boolean` is **private** — subclasses cannot bypass the lifecycle guard
- **Template Method pattern**: `connect()` / `disconnect()` are the public template methods; each delegates to a `protected abstract do*()` hook
- `connect()` and `disconnect()` are idempotent (no-op if already in desired state)
- `connect()` wraps `doConnect()` in a try/catch that throws `ConnectionError`
- Provides a `protected assertConnected()` guard that subclasses (i.e. `NodeProviderBase`) call before any read

Abstract hooks: `doConnect()`, `doDisconnect()` — lifecycle only

### NodeProviderBase (Abstract)

- Extends `BaseConnector` and **implements `INodeReader`** — this is the layer that introduces node reads (block number, native balance). `BaseConnector` itself stays lifecycle-only.
- Not directly instantiated
- Owns the read-side Template Method pieces: public `getBlockNumber()` / `getBalance(address)` each call `assertConnected()` (inherited from `BaseConnector`) then delegate to a `protected abstract do*()` hook
- Abstract read hooks introduced here: `doGetBlockNumber()`, `doGetBalance(address)` — subclasses (`EVMConnector`, `SolanaConnector`) override with library implementations
- Provides shared infrastructure to both `EVMConnector` and `SolanaConnector`:
  - `protected withRetry<T>(fn)` — exponential backoff (3×, 300ms base, 2× multiplier)
  - `protected limiter` — p-limit instance (default concurrency: 8)
  - `protected rpcCall<T>(method, params)` — raw JSON-RPC 2.0 via global `fetch` with configurable timeout
- May supply a default `doGetBlockNumber()` / `doGetBalance()` via `rpcCall` (raw JSON-RPC), which subclasses override with their library client. `doConnect()` / `doDisconnect()` remain `BaseConnector`'s lifecycle hooks.
- Config: `maxRetries`, `retryDelay`, `concurrency` (required, not optional)

### EVMConnector

- Extends `NodeProviderBase`, overrides `do*` hooks using `viem`
- Creates `viem` `PublicClient` with `http` transport; viem's built-in transport retry is **disabled** (`retryCount: 0`) to avoid double-retry with inherited `withRetry`
- Optional `viemChain?: Chain` — operates chain-agnostic if omitted
- EVM-specific methods: `getTransaction`, `getTransactionReceipt`, `getGasPrice`, `estimateGas`, `callContract`, `getLogs`, `getCode`, `getNonce`
- **Implements `ITokenReader`** for ERC token reads, using `viem`'s `parseAbi` + `getContract` (per Template Method, the contract calls live here):
  - `getErc20Balance(token, owner)` — ERC-20 `balanceOf(owner)`, fungible amount as `bigint`
  - `getErc721Owner(token, tokenId)` — ERC-721 `ownerOf(tokenId)`, holder address
  - `getErc721Balance(token, owner)` — ERC-721 `balanceOf(owner)`, count of NFTs owned
  - `getErc1155Balance(token, owner, tokenId)` — ERC-1155 `balanceOf(owner, id)`
- ERC-20 metadata helper: `getTokenMetadata` (name, symbol, decimals)

### SolanaConnector

- Extends `NodeProviderBase`, overrides `do*` hooks using `@solana/web3.js`
- Uses `Connection` with configurable `commitment` (default: `'confirmed'`)
- `getBalance()` returns lamports as `bigint`; `getBlockNumber()` returns slot as `bigint`
- Solana-specific methods: `getSlot()`, `getTransaction(signature)`, `getAccountInfo(address)`, `getTokenAccountsByOwner(owner, filter)`
- **Implements `ISplTokenReader`** for SPL token reads:
  - `getSplTokenBalance(owner, mint)` — resolves the owner's token account for the mint (via `getParsedTokenAccountsByOwner` filtered by mint, or the derived ATA) and returns its `TokenAmount` (raw `amount`, `decimals`, `uiAmount`)
  - `getSplTokenAccounts(owner)` — lists all parsed token accounts owned, each with mint + amount
  - Per Known Challenges, `getParsedTokenAccountsByOwner` returns `parsed.info` typed as `unknown` — requires explicit assertion to a typed shape

### BitcoinConnector

- Extends `NodeProviderBase`, **implements `IUtxoReader`** (which extends `INodeReader`)
- **UTXO model, not account-balance.** Bitcoin nodes have no `balanceOf` — a balance is derived by summing unspent outputs. `BitcoinConnector` overrides the read hooks accordingly:
  - `doGetBlockNumber()` — maps to block height via `getblockcount`
  - `doGetBalance(address)` — implemented as `sum(getUtxos(address))`, returned in **satoshis** (`bigint`, 10^8 base unit)
  - `getUtxos(address)` — returns unspent outputs (each: txid, vout, value in sats, scriptPubKey, confirmations)
- **Backend mode (`backend` discriminated-union config):**
  - `'core'` — Bitcoin Core JSON-RPC via inherited `rpcCall`; requires `-txindex` or descriptor/wallet watch to enumerate address UTXOs
  - `'esplora'` / `'electrum'` — external indexer over HTTP for address → UTXO lookups
  - If the configured backend cannot enumerate UTXOs for an arbitrary address, `getUtxos` / `getBalance` throw a typed `UnsupportedOperationError` (no silent zero)
- **Address vs descriptor:** v1 supports address-based balance via an indexer. Descriptor/xpub-based balances (the modern Bitcoin idiom) are noted as future work, not in the initial surface.
- Bitcoin-specific reads such as `getTransaction(txid)` and `getFeeEstimate(targetBlocks)` are kept off `IUtxoReader` (which stays focused on UTXOs + balance) and live on the concrete `BitcoinConnector` for now — promote to a dedicated interface if a second UTXO chain is added.

### ConnectorDecorator (Abstract GoF Base)

- Implements `IBaseConnector` (= lifecycle + native reads) by forwarding all calls to `wrapped: IBaseConnector`
- Concrete decorators extend this and override only the methods they intercept
- **Token reads are not on `IBaseConnector`**, so they are not visible through a standard decorated instance. To get a decorated, retrying/logging ERC read, either access the inner `EVMConnector` directly, or introduce an `EVMConnectorDecorator implements IBaseConnector, ITokenReader` that wraps an `EVMConnector & ITokenReader` and forwards token methods too. Decide this deliberately rather than discovering it later.

### RetryDecorator

- Wraps `getBlockNumber` and `getBalance` with exponential backoff retry
- Options: `maxRetries` (default 3), `retryDelay` (default 300ms)

### LoggingDecorator

- Wraps all `IBaseConnector` methods with structured JSON logging (debug on call, info on success, error on failure)
- Accepts a pluggable `Logger` interface — defaults to `console`

### CacheDecorator

- Caches `getBlockNumber` (TTL: 2s default — ~1 block) and `getBalance` keyed by address (TTL: 10s default)
- Public `invalidate(key?)` for post-transaction cache busting

---

## Dependencies

| Package           | Version   | Role                               | Distribution    |
| ----------------- | --------- | ---------------------------------- | --------------- |
| `viem`            | `^2.38.0` | EVM PublicClient, ABI parsing      | Peer (external) |
| `@solana/web3.js` | `^1.98.0` | Solana Connection, PublicKey       | Bundled         |
| `p-limit`         | `^7.1.0`  | Concurrency in NodeProviderBase    | Bundled         |
| `typescript`      | `^5.9.3`  | Compiler                           | Dev             |
| `tsup`            | `^8.0.0`  | Dual ESM+CJS build with `.d.ts`    | Dev             |
| `@types/node`     | `^20.0.0` | Node built-ins (fetch, setTimeout) | Dev             |

`ethers` excluded — `viem` covers all EVM needs internally.

---

## Build Configuration

**tsconfig.json**

- `target: ES2020`, `module: ESNext`, `moduleResolution: Bundler`
- `strict: true`, `noImplicitOverride: true` (enforces `override` keyword — critical with deep inheritance)
- `noUnusedLocals: true`, `noImplicitReturns: true`

**tsup.config.ts**

- `format: ['esm', 'cjs']`, `dts: true`, `external: ['viem']`, `treeshake: true`, `splitting: false`

**package.json exports**

```json
"main": "dist/index.cjs",
"module": "dist/index.mjs",
"types": "dist/index.d.ts"
```

---

## Implementation Sequence (dependency order)

1. Project setup: `package.json`, `tsconfig.json`, `tsup.config.ts`
2. `src/types/index.ts` — data contracts (no dependencies)
3. `src/errors/index.ts` — error hierarchy (no dependencies)
4. `src/interfaces/*.ts` — `IConnectionManager`, `INodeReader`, `ITokenReader`, `ISplTokenReader`, `IUtxoReader` (extends `INodeReader`), then `IBaseConnector` (composes the first two); imports types only
5. `src/base/BaseConnector.ts` — imports interface + errors
6. `src/connectors/NodeProviderBase.ts` — imports BaseConnector + errors + types
7. `src/connectors/EVMConnector.ts` — imports NodeProviderBase + viem
8. `src/connectors/SolanaConnector.ts` — imports NodeProviderBase + @solana/web3.js
9. `src/connectors/BitcoinConnector.ts` — imports NodeProviderBase + IUtxoReader; Core JSON-RPC via rpcCall and/or indexer HTTP client
10. `src/decorators/ConnectorDecorator.ts` — imports interface only
11. `src/decorators/RetryDecorator.ts`, `LoggingDecorator.ts`, `CacheDecorator.ts`
12. `src/index.ts` — barrel re-exports

---

## Known Challenges

1. **`fetch` availability**: `NodeProviderBase.rpcCall` uses global `fetch` (Node 18+). Safe given `@types/node@20`.
2. **viem `getContract` typing**: `contract.read.*` may infer as `never` in some viem 2.x minors — use `{ public: this.client }` wrapper if needed.
3. **Solana parsed data casting**: `getParsedTokenAccountsByOwner` returns `parsed.info` typed as `unknown` — requires explicit type assertion.
4. **Decorator type narrowing**: `ConnectorDecorator` only exposes `IBaseConnector` methods (lifecycle + native reads). Consumers needing EVM-specific or `ITokenReader` methods on a decorated instance should access the inner connector directly, use a type guard, or use a dedicated `EVMConnectorDecorator` that also implements `ITokenReader`.
5. **ERC-721 balanceOf vs ownerOf ambiguity**: ERC-721 overloads the word "balance" — `balanceOf(owner)` is a count of tokens held, not ownership of a specific id. The segregated `ITokenReader` exposes both `getErc721Balance` (count) and `getErc721Owner` (holder of an id) to keep the distinction explicit and avoid client confusion.
6. **Token contract trust**: `getErc*Balance` calls assume the supplied `token` address implements the relevant standard. A non-conforming or non-contract address will revert or return malformed data; surface these as a typed error rather than letting raw viem errors leak to clients.
7. **Bitcoin has no address-balance RPC**: `getBalance` is derived by summing UTXOs, which a bare Bitcoin Core node cannot do without `-txindex` or a descriptor watch. The `backend` mode (`'core'` vs `'esplora'`/`'electrum'`) determines capability; unsupported configurations must throw `UnsupportedOperationError`, never a silent zero balance.
8. **Bitcoin UTXO set size / unconfirmed outputs**: an address with many UTXOs makes balance summation heavier than a single RPC call; consider pagination on `getUtxos` and a documented policy on whether unconfirmed (0-conf) outputs count toward `getBalance`.
9. **Bitcoin amount precision**: amounts are satoshis (`bigint`, 10^8). Bitcoin Core's JSON-RPC reports BTC as a float (e.g. `0.00150000`) — convert to integer sats carefully to avoid floating-point error (multiply by 1e8 and round, or read `*_sat` fields / indexer integer values where available).

---

## Verification

```bash
# Install
npm install

# Build (produces dist/index.mjs, dist/index.cjs, dist/index.d.ts)
npm run build

# Type check (no emit)
npm run typecheck

# Smoke test
node -e "
const { EVMConnector, RetryDecorator, LoggingDecorator } = require('./dist/index.cjs');
const c = new EVMConnector({
  networkConfig: { chainId: 1, networkName: 'mainnet', rpcUrl: 'https://cloudflare-eth.com' },
  maxRetries: 3, retryDelay: 300, concurrency: 8
});
const connector = new RetryDecorator(new LoggingDecorator(c));
connector.connect()
  .then(() => connector.getBlockNumber())
  .then(console.log)
  .catch(console.error);
"
```

---

## Client Usage

> **Status:** Draft for review. Example of a client microservice consuming `connector-lib` to read the native **POL** balance of an address on the **Polygon** network. Client supplies the node provider URL and the address to check.

Polygon is EVM-based, so this uses `EVMConnector`. POL is the native gas token on Polygon (18 decimals), so this is a `getBalance` call — not an ERC-20 `getTokenBalance` call.

```tsx
import { EVMConnector, LoggingDecorator, RetryDecorator } from "connector-lib";

// Client-supplied inputs
const nodeProviderUrl = process.env.POLYGON_RPC_URL!; // e.g. Alchemy/Infura/QuickNode URL
const address = "0xYourAddressToCheck";

async function readPolBalance(): Promise<bigint> {
  const connector = new EVMConnector({
    networkConfig: {
      chainId: 137, // Polygon mainnet
      networkName: "polygon",
      rpcUrl: nodeProviderUrl,
    },
    maxRetries: 3,
    retryDelay: 300,
    concurrency: 8,
  });

  // Optional but recommended: wrap with decorators for resilience + observability
  const client = new RetryDecorator(new LoggingDecorator(connector));

  await client.connect();
  try {
    const balanceWei = await client.getBalance(address); // POL in wei (18 decimals)
    return balanceWei;
  } finally {
    await client.disconnect();
  }
}
```

### Notes

- **POL is native, so `getBalance` is correct.** POL has 18 decimals like ETH, so `getBalance` returns a wei-equivalent `bigint`. To display it, the client divides by 10^18 (e.g. viem's `formatEther`, or its own formatting). This is a client-side display concern; the library returns raw `bigint`.
- **`chainId: 137` is Polygon mainnet** (Amoy testnet would be `80002`). The `networkConfig` is mostly metadata — the actual chain is determined by whatever `rpcUrl` points at. **Latent footgun:** nothing currently verifies the RPC endpoint's real chain ID matches the declared `chainId`. Consider having `doConnect()` call `eth_chainId` and throw a `ConnectionError` on mismatch, turning a silent "wrong network" bug into a loud failure.
- **Decorators are optional.** The bare `connector.getBalance(address)` works on its own. The `RetryDecorator` / `LoggingDecorator` wrapping is what you'd want in production for transient RPC failures and structured logs.
- **Decorator type narrowing (per Known Challenges).** `getBalance` and `getBlockNumber` are on `IBaseConnector`, so they're available on the decorated instance. EVM token reads on `ITokenReader` (e.g. `getErc20Balance` for an ERC-20 like USDC) are **not** exposed through the standard `ConnectorDecorator` — the client accesses the inner `EVMConnector`, uses a type guard, or uses an `EVMConnectorDecorator` that also implements `ITokenReader`. Native POL balance avoids this entirely.

### Reading an SPL token balance (Solana)

Mirrors the POL example, but on Solana. SPL token reads use `SolanaConnector`'s `ISplTokenReader`. The client supplies the node provider URL, the owner (wallet) address, and the token mint address.

```tsx
import { SolanaConnector, LoggingDecorator } from "connector-lib";

// Client-supplied inputs
const nodeProviderUrl = process.env.SOLANA_RPC_URL!; // e.g. Helius/QuickNode/Triton URL
const owner = "OwnerWalletAddressBase58";
const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // e.g. USDC mint

async function readSplBalance() {
  const connector = new SolanaConnector({
    networkConfig: {
      chainId: 101, // Solana mainnet-beta (library convention)
      networkName: "solana-mainnet",
      rpcUrl: nodeProviderUrl,
    },
    commitment: "confirmed",
    maxRetries: 3,
    retryDelay: 300,
    concurrency: 8,
  });

  const client = new LoggingDecorator(connector);
  await client.connect();
  try {
    // ISplTokenReader lives on SolanaConnector, not on IBaseConnector,
    // so access it on the concrete connector (not through a base decorator).
    const { amount, decimals, uiAmount } = await connector.getSplTokenBalance(
      owner,
      mint,
    );
    return { raw: amount, decimals, uiAmount }; // uiAmount is human-readable
  } finally {
    await client.disconnect();
  }
}
```

Notes:

- **`getSplTokenBalance` returns a `TokenAmount`, not a bare `bigint`.** SPL mints define their own decimals (USDC = 6, not 18), so the raw `amount` is meaningless without `decimals`. `uiAmount` is the pre-divided human-readable value. This differs from `getBalance`, which returns native SOL as lamports (`bigint`, fixed 9 decimals).
- **No ATA = zero balance.** If the owner has never held the mint, no token account exists. Decide the contract deliberately: return a zero `TokenAmount`, or throw a typed `TokenAccountNotFoundError`. Returning zero is usually friendlier for a balance read.
- **Token-reader access through decorators.** Like `ITokenReader` on the EVM side, `ISplTokenReader` is not on `IBaseConnector`, so a base `ConnectorDecorator` won't expose `getSplTokenBalance`. Access it on the concrete `SolanaConnector`, or use a Solana-aware decorator that also implements `ISplTokenReader`.
- **`chainId: 101` is a library convention.** Solana has no EVM-style numeric chain id; 101/102/103 (mainnet/testnet/devnet) is a common convention. The real network is determined by the `rpcUrl`. The `eth_chainId` mismatch guard from the POL example is EVM-only and does not apply here.

### Reading an ERC-20 token balance (USDC on Polygon)

The EVM counterpart to the SPL example. ERC-20 reads use `EVMConnector`'s `ITokenReader`. The client supplies the node provider URL, the token contract address, and the owner address.

```tsx
import { EVMConnector, LoggingDecorator, RetryDecorator } from "connector-lib";

// Client-supplied inputs
const nodeProviderUrl = process.env.POLYGON_RPC_URL!;
const usdc = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"; // USDC on Polygon (6 decimals)
const owner = "0xOwnerAddressToCheck";

async function readUsdcBalance(): Promise<bigint> {
  const connector = new EVMConnector({
    networkConfig: {
      chainId: 137, // Polygon mainnet
      networkName: "polygon",
      rpcUrl: nodeProviderUrl,
    },
    maxRetries: 3,
    retryDelay: 300,
    concurrency: 8,
  });

  // Lifecycle/native reads can be decorated; the token read is called on the
  // concrete connector because ITokenReader is not on IBaseConnector.
  const lifecycle = new RetryDecorator(new LoggingDecorator(connector));
  await lifecycle.connect();
  try {
    const raw = await connector.getErc20Balance(usdc, owner); // raw units, 6 decimals
    return raw;
  } finally {
    await lifecycle.disconnect();
  }
}
```

Notes:

- **Decimals are token-defined, not 18.** USDC uses 6 decimals, so a raw balance of `1_500_000n` is 1.5 USDC, not 0.0000000000015. Always divide by `10 ** decimals` for display — fetch decimals via `getTokenMetadata`, or use viem's `formatUnits(raw, 6)`. Hardcoding 18 (the ETH/POL default) is the single most common ERC-20 display bug.
- **`getErc20Balance` returns a bare `bigint`** (raw units), consistent with the EVM side returning raw integer amounts. Contrast with SPL's `TokenAmount`, which bundles decimals because Solana's RPC returns them inline. The asymmetry is inherent to the two ecosystems' RPC shapes.
- **Token read is on the concrete connector.** As with SPL, `ITokenReader` is not part of `IBaseConnector`, so `getErc20Balance` isn't visible on a base `ConnectorDecorator`. Here the decorators wrap the lifecycle (`connect`/`disconnect`) while the token read goes to the inner `EVMConnector` — or use an `EVMConnectorDecorator` that also implements `ITokenReader` if you want the token read retried/logged too.
- **Same chainId-mismatch footgun applies.** The `eth_chainId` validation suggested in the POL example guards this case as well — reading USDC against an RPC that's secretly pointed at a different EVM chain returns a plausible-but-wrong balance.
