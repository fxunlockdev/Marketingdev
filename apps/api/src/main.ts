import { createApplication } from './app.js';
import { configFromEnv } from './config.js';

const runtime = await createApplication(configFromEnv());
await runtime.app.listen(Number(process.env.PORT ?? 3100), '127.0.0.1');
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, async () => { await runtime.close(); process.exit(0); });
