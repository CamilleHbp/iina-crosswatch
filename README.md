# CrossWatch Scrobbler for IINA

A standalone IINA plugin that saves movie and episode playback directly to your CrossWatch local tracker. It uses CrossWatch's native metadata and playback-progress APIs. No Trakt account, Stremio integration, or server-side bridge is needed.

## Requirements

- IINA 1.5 or newer on macOS.
- CrossWatch 0.14 with an enabled local tracker and HTTPS access.
- A dedicated CrossWatch API token with write access to that tracker.
- A TMDb key configured on CrossWatch for title search. Manual IMDb/TMDb IDs also work without search.

## Install

In IINA, open **Settings → Plugins → Install from GitHub** and enter `CamilleHbp/iina-crosswatch`. Alternatively, open the `.iinaplgz` release package in IINA. Restart IINA after installation.

Select **CrossWatch Scrobbler → Preferences**, enter your server's HTTPS URL and dedicated API token, and leave the tracker instance as `default` unless you use another instance. Open **Plugins → CrossWatch** while playing a video and click **Check connection**.

## Watching

The plugin recognizes names such as `The.Matrix.1999.mkv`, `Severance.S01E02.mkv`, and `Severance.1x02.mkv`. Movies require an exact title and year for automatic matching. Series require a unique exact title match. A filename containing an IMDb ID can be matched directly.

For ambiguous names, multi-episode files, or streams with opaque filenames, use the CrossWatch sidebar to search and select a title. For episodes, enter the season and episode. You can also enter a movie or series IMDb ID (`tt0133093`) or TMDb number (`603`). Manual selections are remembered for that filename. The **Plugin → Identify video by ID…** menu also provides native macOS dialogs for ID entry, and **Check CrossWatch connection** tests the server directly.

Progress is saved every 30 seconds and when playback pauses or stops. At 80% completion, after at least 60 seconds of actual playback, the plugin records watched history and clears the resume entry. Both thresholds can be adjusted. For short videos, the minimum is half the duration. Seeking does not count toward the minimum playback time. History is recorded once per playback session; starting the file again permits a rewatch.

Failed updates are retained in IINA's plugin preferences and retried with backoff. Open a player window after restarting IINA to resume pending deliveries. Retries retain the original watched timestamp. Updates remain bound to the server URL and tracker instance where they were created.

The plugin writes the local CrossWatch tracker only. Existing CrossWatch sync pairs can distribute that history to other services. The integration saves progress and watched history; it does not create a live Watcher session on CrossWatch's scrobbler dashboard.

## Privacy and permissions

Only the configured CrossWatch server receives requests. Title searches send the parsed title and optional year; local paths and stream credentials are not sent. CrossWatch performs metadata lookups using its own provider settings.

The API token is stored in local IINA plugin preferences, not in the plugin package. CrossWatch tokens inherit their account's permissions; use a dedicated token and revoke it from CrossWatch when uninstalling. Pending media updates and remembered matches are also stored locally.

IINA's file-system permission is needed to run macOS `/usr/bin/curl`, because its built-in HTTP API cannot encode the JSON bodies required by CrossWatch. Requests use private temporary files so tokens and request bodies are not exposed in process arguments. No shell commands are constructed from media names. HTTPS is required, certificate verification is enabled, redirects are not followed, and requests time out after 30 seconds. Broad network-domain permission allows users to choose their own server.

## Development

No npm dependencies are required. Run `npm test` with Node.js 18 or newer. Run `npm run build` with Python 3 to generate reproducible `.iinaplgz` and ZIP archives in `dist/`.

The implementation targets these native CrossWatch endpoints:

- `GET /api/app-auth/tokens/whoami`
- `GET /api/metadata/search`
- `POST /api/playback_progress/actions/update_progress`
- `POST /api/playback_progress/actions/mark_watched`

See the [IINA plugin API](https://docs.iina.io/) and [CrossWatch source](https://github.com/cenodude/CrossWatch) for their respective APIs. This is an independent plugin and is not an official IINA or CrossWatch project.
