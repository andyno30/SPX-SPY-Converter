# SPY Options updater operations

The public page is [spyconverter.com/options/](https://spyconverter.com/options/). It reads only the generated `data/spy-options.json` file from this repository. Browser visits do not call SaveTicker.

## Production updater

`.github/workflows/update-spy-options.yml` runs on GitHub Actions at approximately 15-minute intervals during the broad U.S. market-session UTC window on weekdays. It can also be started with **Actions → Update SPY Options → Run workflow**.

Each run:

1. Restores the encrypted `SAVETICKER_AUTH_JSON_B64` repository secret to a temporary runner file.
2. Calls the authenticated SaveTicker SPY options endpoint once through `scripts/sync_saveticker_direct.py`.
3. Validates and normalizes the response.
4. Commits `data/spy-options.json` only when the generated data changed.
5. Removes the temporary session file.

The updater does not write raw response captures. It writes the public JSON only after a successful HTTP response and schema check, so HTTP 401/errors leave the last known-good data in place. A 401 is reported as an authentication-expired error in the workflow log.

## Refreshing the SaveTicker session

The private session is never stored in Git. To refresh it locally:

```bash
python -m pip install -r scripts/requirements-saveticker.txt
python -m playwright install chromium
python scripts/refresh_saveticker_auth.py
```

Log in manually in the Chromium window and press Enter in the terminal. The script writes the ignored `saveticker-auth.json` file in the repository root. It does not automate or store a username/password.

Then replace the GitHub Actions secret with a fresh base64 encoding of that file:

```bash
base64 < saveticker-auth.json | pbcopy
```

In GitHub, open **Settings → Secrets and variables → Actions**, select `SAVETICKER_AUTH_JSON_B64`, and paste the clipboard value. Never paste the session contents into source code, issues, or logs.

## Manual local update

With a local ignored `saveticker-auth.json` present:

```bash
python scripts/sync_saveticker_direct.py
```

To use a session file stored elsewhere without copying it into the repository:

```bash
SAVETICKER_AUTH_FILE=/path/to/saveticker-auth.json python scripts/sync_saveticker_direct.py
```

The successful update time is stored in `data/spy-options.json` as `sourceUpdatedAt`, and the most recent workflow run is visible under the repository’s **Actions** tab.

## Source-folder cleanup

Once the integration has been verified and the GitHub secret has been configured, the old `saveticker-auto-dashboard` folder is safe to delete because its updater, dashboard, workflow, and generated sample data have been integrated here. The `saveticker-english-options` folder is also safe to delete after confirming the new manual auth refresh script works; it is development/debug material and contains the old scraper, screenshots, network captures, and local session file. Keep neither folder as a secret store.
