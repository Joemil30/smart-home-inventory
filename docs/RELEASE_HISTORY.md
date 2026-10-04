# Maintaining Stocked's release history

Every production deployment must leave two records:

1. A section in `CHANGELOG.md` that explains the visible and technical changes.
2. A branch named `release/stocked-vNN` that preserves the exact deployed files.

## Preserved releases

| Version | Git tag / snapshot branch | Summary |
|---|---|---|
| v62 | `stocked-v62` / `release/stocked-v62` | Household design, local recipe imagery, clearer inventory and shopping, portable backup updates |
| v61 | `stocked-v61` / `release/stocked-v61` | Recipe studio, serving scaling, conversions, cooking mode, light default |
| v60 | `stocked-v60` / `release/stocked-v60` | Connected food experience |
| v59 | `stocked-v59` / `release/stocked-v59` | Baseline preserved before the connected-experience releases |

The log records shipped versions, not every keystroke or household-data edit.
Each Git commit retains its exact source changes. Never move a release tag to
different files after publishing it.

## Release procedure

1. Start from the current live deployment branch: `claude/cold-room-pwa-mpph5h`.
2. Make changes on a separate feature branch.
3. Update the cache version in `sw.js` so installed phones receive the release.
4. Add the new version to `CHANGELOG.md` before committing.
5. Run the full browser suite and phone-sized visual checks.
6. Commit the reviewed release and create `release/stocked-vNN` and tag `stocked-vNN` at that commit. Push both snapshots as well as the deployment branch.
7. Push the release commit to `claude/cold-room-pwa-mpph5h`.
8. Wait for the GitHub Pages workflow and smoke-test Home, Inventory, Recipes,
   recipe-to-shopping, refresh, and offline startup on the live URL.

## Rollback

If a critical flow fails after deployment, revert the release commit and push the
revert to the deployment branch. Do not rewrite the deployment branch's history.
The preceding `release/stocked-vNN` branch is the source of truth for the last known-good files.

Rollback triggers: the app cannot boot, an upgrade changes existing household
records, core capture/shopping/recipe flows fail, or the new shell cannot launch
offline after installation. A rollback must ship a changed service-worker cache
version so installed clients notice it. Never clear IndexedDB as a rollout fix.

This project has no production error-rate/latency telemetry or on-call system.
Do not report those metrics as nominal without evidence. The release gate is
local browser testing plus post-deploy checks; the current GitHub Pages workflow
publishes files but does not run the test suite. Real-device camera and shared
household concurrency remain separate validation work.

## Required release evidence

- Full test result
- Deployment workflow result
- Live URL and deployed commit
- Smoke-test result
- Any known limitations carried into the release
