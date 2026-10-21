import { createApplication } from './app.js';
import { configFromEnv } from './config.js';
import { setTimeout } from 'node:timers/promises';

const runtime = await createApplication(configFromEnv());
await runtime.app.listen(Number(process.env.PORT ?? 3100), '127.0.0.1');
let stopping=false;
const mailLoop=(async()=>{
  while(!stopping) {
    try {await runtime.mailWorker.runOnce();} catch {process.stderr.write('Email worker unavailable; durable queue retained\n');}
    if(!stopping) await setTimeout(2000);
  }
})();
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, async () => { stopping=true;await mailLoop;await runtime.close();process.exit(0); });
