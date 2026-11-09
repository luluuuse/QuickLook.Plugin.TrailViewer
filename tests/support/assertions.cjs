function createChecker(scope = '') {
  const failures = [];
  function check(what, ok, detail) {
    const label = scope ? `${scope}: ${what}` : what;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures.push(label);
  }
  function equal(what, got, want) {
    check(what, Object.is(got, want), `${got} vs ${want}`);
  }
  function finish(success = 'all checks passed') {
    if (failures.length) {
      console.error(`\n${failures.length} failed: ${failures.join(', ')}`);
      return 1;
    }
    console.log(`\n${success}`);
    return 0;
  }
  return { check, equal, failures, finish };
}

module.exports = { createChecker };
