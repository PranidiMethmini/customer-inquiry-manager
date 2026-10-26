import 'dotenv/config';
import { createApp } from './app.js';
import { readConfig } from './config.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const runtime = createApp(readConfig());
const server = runtime.app.listen(port, '127.0.0.1', () => {
  console.log(`API listening at http://127.0.0.1:${port}`);
});
server.on('error', (error) => {
  console.error('API failed to start.');
  process.exitCode = 1;
  void runtime.close();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { server.close(() => { void runtime.close(); }); });
}
