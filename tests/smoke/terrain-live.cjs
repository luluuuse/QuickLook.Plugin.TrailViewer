const https = require('https');

function probeLive(host, path) {
  return new Promise((resolve) => {
    const request = https.get({
      host,
      path,
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
  const sources = [
    ['CyclOSM', 'a.tile-cyclosm.openstreetmap.fr', '/cyclosm/13/6784/3376.png'],
    ['OpenHikingMap', 'tile.openmaps.fr', '/openhikingmap/5/16/10.png'],
    ['OpenTopoMap', 'a.tile.opentopomap.org', '/5/16/10.png'],
  ];
  let failed = false;
  for (const [name, host, path] of sources) {
    const result = await probeLive(host, path);
    const ok = result.status === 200 && result.bytes > 5000;
    console.log(`${ok ? 'PASS' : 'FAIL'}  live ${name} tile  ${result.status} / ${result.bytes} bytes`);
    failed ||= !ok;
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
