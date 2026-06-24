/**
 * EVM token reads. Implemented only by EVMConnector — ERC-20/721/1155 are
 * EVM-specific standards with no direct Solana equivalent.
 */
export interface ITokenReader {
  /** ERC-20 `balanceOf(owner)` — raw units as bigint (decimals are token-defined). */
  getErc20Balance(token: string, owner: string): Promise<bigint>;

  /** ERC-721 `ownerOf(tokenId)` — address of the token holder. */
  getErc721Owner(token: string, tokenId: bigint): Promise<string>;

  /** ERC-721 `balanceOf(owner)` — count of NFTs owned by the address. */
  getErc721Balance(token: string, owner: string): Promise<bigint>;

  /** ERC-1155 `balanceOf(owner, id)` — raw unit balance for a specific token id. */
  getErc1155Balance(token: string, owner: string, tokenId: bigint): Promise<bigint>;
}
