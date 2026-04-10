# Release Process

HappyTG uses a manual-but-guarded GitHub workflow for tags and GitHub Releases.

## Prepare the release

1. Update every workspace `package.json` version to the target release version.
2. Add a matching `## vX.Y.Z` section to [`CHANGELOG.md`](../CHANGELOG.md).
3. Add release notes at [`docs/releases/X.Y.Z.md`](./releases/).
4. Verify metadata locally:

   ```bash
   pnpm release:check --version X.Y.Z
   ```

## Publish the release

1. Merge the release-ready commit to `main`.
2. In GitHub Actions, run the `Release` workflow from `main`.
3. Enter the version without the leading `v`.
4. Leave `draft=true` for the safer default unless you are ready to publish immediately.

## Safety checks enforced by the workflow

- runs only from the latest commit on the default branch
- refuses an existing tag or GitHub Release
- verifies package versions, changelog, and release notes
- reruns `pnpm typecheck`, `pnpm test`, and `pnpm build` before creating the tag and GitHub Release
