# ZeroPress WXR Starter

Try ZeroPress with an export from your WordPress site. Your posts and pages become
a static site using the Minimal theme; images and comments stay on WordPress.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zeropress-app/zeropress-starter-wxr/tree/latest)

## Try your WordPress content

1. Use the button to create a repository and deploy the included sample site.
   Keep the default commands: `npm run build` and `npm run deploy`.
2. In WordPress, open **Tools → Export**, choose **All content**, and download
   the WXR `.xml` file.
3. Replace `wordpress-export.xml` at the repository root with your export,
   keeping that filename. Commit and push to rebuild your site.

Choose a private repository if your export contains private data, such as
commenters' email addresses. The export itself is not served by the deployed site.

To refresh the site later, replace the same XML file with a new export and push.
Each build replaces the previous generated site, including removing old pages.

## What stays on WordPress

- Images are loaded from their existing URLs. No media files are downloaded or moved.
- Links in post and page content keep their original URLs. They can lead back
  to WordPress; the generated post lists and navigation open the static pages.
- Comments are read from the WordPress REST API using the original post or page
  ID. Submitted comments go to WordPress and follow its moderation settings.
  Comment records in the WXR file are not published.

Keep the original WordPress site and its media available. The comment API must
allow requests from your new site's origin. WordPress also needs to allow
[anonymous REST comments](https://developer.wordpress.org/reference/hooks/rest_allow_anonymous_comments/)
for visitors to submit from this site. If it refuses a request, the comment area
provides a link to the original page. No WordPress credentials are needed here.

The sample export has comments closed. Replacing it with an export containing
posts with open comments enables their comment areas automatically.

## Scope

Published posts, pages, categories, tags, and menus are imported. Drafts, private
content, and password-protected posts are excluded. WordPress plugins, shortcodes,
and PHP-powered features do not run in the static site.

This is a quick trial that continues to depend on WordPress. For a full move,
import your WXR into [ZeroPress Studio](https://github.com/zeropress-app/zeropress-studio)
and publish to a separate [Studio Starter](https://github.com/zeropress-app/zeropress-starter-studio)
repository.

## Local preview

Use Node.js 22.22.0 or later; `.node-version` selects Node.js 24.

```sh
npm ci
npm run dev
```

The preview rebuilds when `wordpress-export.xml`, `wxr-import-base.json`, `theme/`,
or `public/` changes. A failed import keeps the last successful preview.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch the export, rebuild, and serve locally |
| `npm run build` | Convert WXR and generate the static site in `dist/` |
| `npm run preview` | Build once and serve locally |
| `npm run deploy` | Deploy the existing `dist/` |
| `npm run deploy:dry-run` | Build and validate deployment without uploading |
| `npm test` | Check importing, page generation, and comments |
| `npm run format:wrangler` | Format `wrangler.jsonc` |

Site information and the comment API address are inferred from the export.
`wxr-import-base.json` keeps the trial out of search indexes and leaves the new
site URL empty, so no domain setup is required. Generated Preview Data lives in
`.zeropress-wxr/`, outside the published files, and is excluded from Git.

## License

MIT
