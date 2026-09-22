import { Socket } from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { throw new Error('A static WXR build must not access the network.'); };
Socket.prototype.connect = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
