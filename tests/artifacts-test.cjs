// Self-test for the failure bundle itself: a deliberate failed assertion must leave a screenshot, a machine-
// readable result and a Playwright trace. Without this, the diagnostic path can silently stop producing files.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchBrowser } = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');

const { check, failures } = createChecker('artifacts');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'trailviewer-artifacts-'));
  const previous = process.env.TEST_ARTIFACTS;
  process.env.TEST_ARTIFACTS = temporary;
  const artifacts = createArtifacts('self-test');
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    await artifacts.start(page);
    await page.goto('data:text/html,<title>Artifact self-test</title><main>diagnostic bundle</main>');

    const bundle = await artifacts.capture(page, ['intentional failure'], ['diagnostic only']);
    check('a failure creates its suite folder', Boolean(bundle && fs.existsSync(bundle.root)), bundle?.root);
    const screenshotExists = Boolean(bundle && fs.existsSync(bundle.screenshot));
    const traceExists = Boolean(bundle && fs.existsSync(bundle.trace));
    check('the screenshot exists and has pixels',
      screenshotExists && fs.statSync(bundle.screenshot).size > 0, bundle?.screenshot);
    check('the trace exists and has events',
      traceExists && fs.statSync(bundle.trace).size > 0, bundle?.trace);

    const resultPath = bundle && path.join(bundle.root, 'result.json');
    if (resultPath && fs.existsSync(resultPath)) {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      check('the result records the failed assertion',
        result.failures.join('|') === 'intentional failure', result.failures.join('|'));
      check('the result records page errors', result.pageErrors.join('|') === 'diagnostic only');
      check('the result names the trace', result.trace === 'trace.zip', result.trace);
    } else {
      check('the result file exists', false, resultPath);
    }
  } finally {
    if (browser) await browser.close();
    if (previous === undefined) delete process.env.TEST_ARTIFACTS;
    else process.env.TEST_ARTIFACTS = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  console.log(failures.length === 0 ? '\nartifact checks OK' : `\n${failures.length} artifact checks failed`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
