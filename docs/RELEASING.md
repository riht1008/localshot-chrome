# Releasing LocalShot

## Before a release

1. Update the version in both `package.json` and `manifest.json`.
2. Update the implementation status and release notes.
3. Run `npm run check`.
4. Load the extension as an unpacked extension and smoke-test all three capture modes.
5. Review the permissions and the generated file list.

## Create a source release

Create a signed Git tag after committing the release changes:

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

Replace the version with the version being released.

## Chrome extension package

For a Chrome Web Store upload or a distribution ZIP, include the extension files only:

- `manifest.json`
- `src/`
- `tokens.css`

Do not include `.git`, `node_modules`, local screenshots, or development metadata.
