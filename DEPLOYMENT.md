# AlphaGenome MCP Server - Deployment Guide

How a version of `@jolab/alphagenome-mcp` reaches npm, and how to check it afterwards.

The server calls the real AlphaGenome API through the AlphaGenome Python SDK (`alphagenome` 0.9.0 or newer). Nothing is mocked: every tool needs a valid API key, which you can get at https://deepmind.google.com/science/alphagenome (free for non-commercial use, subject to the [terms of use](https://deepmind.google.com/science/alphagenome/terms)).

## Before a release

1. Update `version` in `package.json` and move the `[Unreleased]` entries of `CHANGELOG.md` under the new version.
2. Run the checks that the publish workflow runs:

   ```bash
   npm ci
   npm run lint
   npm run typecheck
   npm test              # builds, then runs the TypeScript unit tests (no API key needed)
   npm run docs:api:check
   npm run test:python   # Python summarizer tests (numpy and pandas only)
   ```

3. Merge to `main`.

## Publishing

Publishing is done by `.github/workflows/publish.yml`. It runs when a GitHub release is **published**, so creating a release is the publish step: do not create one for any other reason.

1. Create a release whose tag is `v` plus the version in `package.json` (for example `v0.3.0`). The workflow fails if the two differ, or if that version is already on npm.
2. The workflow checks out the tag, runs lint, typecheck, build, unit tests and the tool reference check, then publishes with provenance.
3. A publish that failed can be retried for the same tag without recreating the release:

   ```bash
   gh workflow run publish.yml -f tag=v0.3.0
   ```

### Authentication

The workflow uses npm trusted publishing (OIDC). Configure it once on npmjs.com: package Settings > Trusted Publisher > GitHub Actions, with this repository and the workflow filename `publish.yml`. The `NPM_TOKEN` secret is only a fallback; a token needs "bypass 2FA" to publish from CI.

If the trusted publisher allows staged publishing only, the workflow stages the version instead of publishing it. The version is then **not on npm yet**: a maintainer approves it with 2FA:

```bash
npm stage list @jolab/alphagenome-mcp
npm stage approve <stage-id>
```

The job summary says which of the two happened.

## After publishing

1. Check https://www.npmjs.com/package/@jolab/alphagenome-mcp for the new version (npm can take a few minutes).
2. Install it in a client with a real key:

   ```bash
   claude mcp add alphagenome --env ALPHAGENOME_API_KEY=YOUR_API_KEY -- npx -y @jolab/alphagenome-mcp@latest
   ```

   or, for Claude Desktop, in `claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "alphagenome": {
         "command": "npx",
         "args": ["-y", "@jolab/alphagenome-mcp@latest"],
         "env": {
           "ALPHAGENOME_API_KEY": "your-api-key-here"
         }
       }
     }
   }
   ```

3. The machine needs Python 3.10+ with `alphagenome` and `numpy` installed (see [Python environment](README.md#python-environment)). Set `ALPHAGENOME_PYTHON` if the interpreter is not `python3` or `python` on the PATH.
4. Try a single-nucleotide variant (answered from the Atlas) and an indel (answered by live inference), and check the `source` line of each result:

   ```
   "Use alphagenome to score chr19:44908822 C>T"
   "Use alphagenome to score the deletion chr17:49210289 CCC>C"
   ```

## Troubleshooting

### The publish workflow fails

- **Tag and version differ**: the release tag must be `v` + `package.json` version.
- **Version already on npm**: bump the version; npm does not accept the same version twice.
- **`E403`, `EOTP` or `OIDC permission denied`**: the workflow falls back to staging; approve the staged version as above. Otherwise check the trusted publisher settings.

### The client cannot use the server

See [Troubleshooting](README.md#troubleshooting) in the README for the error messages the server returns (missing interpreter, missing `alphagenome` package, missing or rejected API key, quota, timeout).

## Support

- **GitHub Issues**: https://github.com/taehojo/alphagenome-mcp/issues
- **Email**: taehjo@gmail.com
