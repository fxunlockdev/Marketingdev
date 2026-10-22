import {listenAddress} from './listen.js';
import { createApplication } from './app.js';
import { configFromEnv } from './config.js';
import { setTimeout } from 'node:timers/promises';

const address=listenAddress();
const runtime = await createApplication(configFromEnv());
try{await runtime.app.listen(address.port,address.host);}catch{await runtime.close();throw new Error('API listener could not start');}
let stopping=false;
const mailLoop=(async()=>{
  while(!stopping) {
    try {await runtime.mailWorker.runOnce();} catch {process.stderr.write('Email worker unavailable; durable queue retained\n');}
    if(!stopping) await setTimeout(2000);
  }
})();
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, async () => { stopping=true;await mailLoop;await runtime.close();process.exit(0); });
