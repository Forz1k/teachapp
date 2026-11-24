// Run locally, not in CI. stdout contains a master secret; never commit it.
import {createPersonalCode,personalTokenHashes} from '../js/personal-sync.js';
const endpoint=process.argv[2];
if(!endpoint){console.error('Usage: node tools/personal-sync-code.mjs https://your-approved-worker.example');process.exit(1);}
const code=createPersonalCode(endpoint);
console.log('PERSONAL CODE (secret, save privately):\n'+code);
console.log('TEACHAPP_SYNC_TOKEN_HASHES (GitHub Actions secret):\n'+JSON.stringify(await personalTokenHashes(code)));
