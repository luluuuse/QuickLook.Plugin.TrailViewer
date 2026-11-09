const fs = require('fs');
const path = require('path');

function createArtifacts(suite) {
  const root = process.env.TEST_ARTIFACTS
    ? path.resolve(process.env.TEST_ARTIFACTS, suite)
    : path.resolve(__dirname, '..', '..', 'test-results', suite);
  const recording = new WeakSet();

  return {
    async start(page) {
      const context = page.context();
      if (recording.has(context)) return;
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      recording.add(context);
    },

    async capture(page, failures, pageErrors = []) {
      const context = page.context();
      const isRecording = recording.has(context);
      if (!failures.length) {
        if (isRecording) await context.tracing.stop().catch(() => {});
        return null;
      }

      fs.mkdirSync(root, { recursive: true });
      const screenshot = path.join(root, 'failure.png');
      const trace = path.join(root, 'trace.zip');
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      if (isRecording) {
        await context.tracing.stop({ path: trace }).catch(() => {});
      }

      fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({
        suite,
        capturedAt: new Date().toISOString(),
        failures,
        pageErrors,
        trace: fs.existsSync(trace) ? path.basename(trace) : null,
      }, null, 2));
      return { screenshot, trace, root };
    },
  };
}

module.exports = { createArtifacts };
