# Maintaining Stocked's release history

Every production deployment must leave two records:

1. A section in `CHANGELOG.md` that explains the visible and technical changes.
2. A branch named `release/stocked-vNN` that preserves the exact deployed files.

## Release procedure

1. Start from the current live deployment branch: `claude/cold-room-pwa-mpph5h`.
2. Make changes on a separate feature branch.
3. Update the cache version in `sw.js` so installed phones receive the release.
4. Add the new version to `CHANGELOG.md` before committing.
5. Run the full browser suite and phone-sized visual checks.
6. Commit the reviewed release and create `release/stocked-vNN` at that commit.
7. Push the release commit to `claude/cold-room-pwa-mpph5h`.
8. Wait for the GitHub Pages workflow and smoke-test Home, Inventory, Recipes,
   recipe-to-shopping, refresh, and offline startup on the live URL.

## Rollback

If a critical flow fails after deployment, revert the release commit and push the
revert to the deployment branch. Do not rewrite the deployment branch's history.
The preceding `release/stocked-vNN` branch is the source of truth for the last known-good files.

## Required release evidence

- Full test result
- Deployment workflow result
- Live URL and deployed commit
- Smoke-test result
- Any known limitations carried into the release
