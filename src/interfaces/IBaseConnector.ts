import type { IConnectionManager } from './IConnectionManager.js';
import type { INodeReader } from './INodeReader.js';

/** Composed interface: lifecycle management + generic node reads. */
export interface IBaseConnector extends IConnectionManager, INodeReader {}
