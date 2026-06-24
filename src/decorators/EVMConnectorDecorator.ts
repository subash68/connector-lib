import { ConnectorDecorator } from './ConnectorDecorator.js';
import type { IBaseConnector } from '../interfaces/IBaseConnector.js';
import type { ITokenReader } from '../interfaces/ITokenReader.js';

type IEVMConnector = IBaseConnector & ITokenReader;

/**
 * Abstract GoF Decorator base for EVM connectors. Extends ConnectorDecorator
 * and additionally implements ITokenReader by forwarding all token reads to the
 * wrapped connector. Concrete subclasses override only the methods they intercept.
 *
 * Use this instead of ConnectorDecorator when you need decorated ERC token reads
 * (getErc20Balance, getErc721Owner, etc.) to be visible on the decorated instance.
 */
export abstract class EVMConnectorDecorator extends ConnectorDecorator implements ITokenReader {
  protected declare readonly wrapped: IEVMConnector;

  constructor(connector: IEVMConnector) {
    super(connector);
  }

  getErc20Balance(token: string, owner: string): Promise<bigint> {
    return this.wrapped.getErc20Balance(token, owner);
  }

  getErc721Owner(token: string, tokenId: bigint): Promise<string> {
    return this.wrapped.getErc721Owner(token, tokenId);
  }

  getErc721Balance(token: string, owner: string): Promise<bigint> {
    return this.wrapped.getErc721Balance(token, owner);
  }

  getErc1155Balance(token: string, owner: string, tokenId: bigint): Promise<bigint> {
    return this.wrapped.getErc1155Balance(token, owner, tokenId);
  }
}
