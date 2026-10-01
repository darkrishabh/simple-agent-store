# Project website

The OSS landing page lives in `site/` and publishes to [GitHub Pages](https://darkrishabh.github.io/simple-agent-store/). It is static HTML, CSS and a small copy-button script. It does not run a store, connect to localhost, accept user data, or provide a hosted MCP service.

## Edit and verify

```bash
npm run site:check
python3 -m http.server 4398 --bind 127.0.0.1 --directory site
```

Preview at `http://127.0.0.1:4398`. Check desktop/mobile layout, keyboard navigation, the command copy button, FAQ disclosures, and links. Keep asset URLs relative so the `/simple-agent-store/` project path works. The public URL is also present in canonical, Open Graph, robots and sitemap metadata.

## Publish

Repository Settings → Pages must use **GitHub Actions**. `.github/workflows/pages.yml` uploads only `site/`, never the repository root, databases, environment files, or the private CRUD dashboard. It deploys only from `main`, using the `github-pages` environment. Pull requests validate the site through the normal CI gate without deploying it.

Changes to site files on `main` trigger deployment. The workflow can also be dispatched manually from `main`. Revert the relevant source commit and redeploy to roll back. Verify the public URL and the deployment result before sharing.

The registered `simpleagentstore.com` domain is not connected by this workflow. Attaching it requires a separate custom-domain/DNS change; update canonical/social/sitemap URLs at the same time. Do not add a `CNAME` file until that change is intended.

## Claims and examples

Describe this release as a local, single-user, SQLite-backed open-source alpha. Examples are illustrative, not live client sessions. No hosted-service promises, invented benchmark scores or automatic-saving guarantees. Link to the source, security policy and readiness boundaries.
