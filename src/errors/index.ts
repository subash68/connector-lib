export class ConnectorError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export class ConnectionError extends ConnectorError {
  constructor(rpcUrl: string, cause?: unknown) {
    super(`Failed to connect to ${rpcUrl}`, cause);
    this.name = 'ConnectionError';
  }
}

export class NotConnectedError extends ConnectorError {
  constructor() {
    super('Connector is not connected. Call connect() first.');
    this.name = 'NotConnectedError';
  }
}

export class RetryExhaustedError extends ConnectorError {
  constructor(public readonly attempts: number, cause?: unknown) {
    super(`All ${attempts} retry attempts exhausted`, cause);
    this.name = 'RetryExhaustedError';
  }
}

export class UnsupportedOperationError extends ConnectorError {
  constructor(operation: string, connectorName: string) {
    super(`Operation "${operation}" is not supported by ${connectorName}`);
    this.name = 'UnsupportedOperationError';
  }
}

export class ContractCallError extends ConnectorError {
  constructor(contractAddress: string, fn: string, cause?: unknown) {
    super(`Contract call ${fn} on ${contractAddress} failed`, cause);
    this.name = 'ContractCallError';
  }
}
