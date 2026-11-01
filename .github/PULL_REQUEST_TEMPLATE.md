## What changed

<!-- One or two sentences. If it fixes a detector case, say which class. -->

## Why

<!-- The failure this prevents, ideally with the document shape that triggers it. -->

## Kind of change

- [ ] Detector (new cover type, missed leak, false positive)
- [ ] CLI, output or exit codes
- [ ] GitHub Action / sweep workflow
- [ ] Library API or types
- [ ] Documentation
- [ ] Release or packaging

## Checklist

- [ ] Tests added or updated for the behaviour change
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] If detector behaviour changed: `npm run bench:check` passes and the numbers in `BENCHMARK.md` are regenerated
- [ ] No new runtime dependency (or the PR body explains why it is unavoidable)
- [ ] No real confidential PDF, covered text or personal data committed
- [ ] Documented thresholds in `README.md` and `docs/algorithm.md` still match the code
