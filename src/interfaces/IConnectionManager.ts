export interface IConnectionManager {
  readonly chainId: number;
  readonly networkName: string;
  readonly rpcUrl: string;
  isConnected(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
