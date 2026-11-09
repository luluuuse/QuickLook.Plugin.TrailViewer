const https = require('https');

function probeLive() {
  return new Promise((resolve) => {
    const request = https.get({
      host: 'a.tile-cyclosm.openstreetmap.fr',
      path: '/cyclosm/13/6784/3376.png',
      headers: { 'User-Agent': 'QuickLook.Plugin.TrailViewer smoke-test' },
      timeout: 20000,
    }, (response) => {
      let bytes = 0;
      response.on('data', (chunk) => { bytes += chunk.length; });
      response.on('end', () => resolve({ status: response.statusCode, bytes }));
    });
    request.on('timeout', () => {
      request.destroy();
      resolve({ status: 'timeout', bytes: 0 });
    });
    request.on('error', (error) => resolve({ status: error.code || 'error', bytes: 0 }));
  });
}

async function main() {
  const result = await probeLive();
  const ok = result.status === 200 && result.bytes > 5000;
  console.log(`${ok ? 'PASS' : 'FAIL'}  live CyclOSM tile  ${result.status} / ${result.bytes} bytes`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
