import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listenMock } from './server.mjs';

try {
  const server = await listenMock(Number(process.env.QRR_MOCK_PORT || 8089));
  const port = server.address().port;
  console.log(
    `Local Dolibarr mock listening on 127.0.0.1:${port}. Data resets when this command restarts.`
  );
  const angular = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/@angular/cli/bin/ng.js', import.meta.url)),
      'serve',
      '--configuration',
      'mock',
      ...process.argv.slice(2),
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, QRR_MOCK_PORT: String(port) },
      stdio: 'inherit',
    }
  );
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    angular.kill('SIGTERM');
    server.closeAllConnections();
    server.close();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  angular.once('error', error => {
    console.error(error.message);
    stop();
    process.exitCode = 1;
  });
  angular.once('exit', code => {
    stop();
    if (!process.exitCode) process.exitCode = code || 0;
  });
} catch (error) {
  console.error(`Cannot start local development: ${error.message}`);
  process.exitCode = 1;
}
