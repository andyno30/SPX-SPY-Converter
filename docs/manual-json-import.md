# Manual News and Options JSON import

Run from the repository root using Python 3.10 or newer. No additional packages
or browser automation are needed. The importer never contacts SaveTicker.

## Paste a response

1. Copy the complete SaveTicker JSON response in your normal Chrome browser.
2. Run:

   ```sh
   python3 scripts/manual_json_import.py
   ```

3. Paste one complete JSON response and press **Enter**. Input stays visible.
   Multiline and long single-line JSON are supported; the importer detects the
   closing JSON boundary and validates the entire response before any write.
4. Valid JSON imports immediately under the existing Supabase protections.
   No `END` marker or confirmation is needed. The result includes the detected
   ticker or Reuters/FJ feed, validation status and inserted/updated/skipped counts.
5. Paste the next response and press **Enter** without restarting the command.
   Type **QUIT** on its own line and press **Enter** to exit, or use **Ctrl-C**.
   QUIT discards any unfinished paste; completed imports remain.

Each response is handled separately. An invalid complete response reports its
error and leaves the session ready for another paste. A response missing its
closing brace/bracket waits for the remaining JSON. The database lock is
released between imports, including while waiting for more input. File and
pipe commands still process their input once and exit.

The importer detects Options by `symbol` and News by `news_list`. You do not
need to select a ticker or News group. It reports `inserted`, `updated`,
`skipped`, and `errors`, with reasons for Options skips and a final total.
Malformed JSON reports its line, column and reason without quoting field names,
values or surrounding input. Duplicate keys and non-finite numbers are rejected
with their location as well.
A nonzero exit status indicates an error; successfully completed items are not
rolled back. If a network failure makes a write outcome uncertain, the report
says so and does not retry automatically. Reimporting safely rechecks the cache
and existing News IDs.

## Files, batches, and previews

```sh
# Compare against Supabase without writing or archiving anything.
python3 scripts/manual_json_import.py --dry-run

# Validate input without credentials or any network access.
python3 scripts/manual_json_import.py --validate-only response.json

# Import multiple local response files (News and Options can be mixed).
python3 scripts/manual_json_import.py news-group-1.json news-group-6.json SPY.json QQQ.json

# Read JSON from a pipe instead of interactive input.
cat SPY.json | python3 scripts/manual_json_import.py
```

A file or paste may also be a JSON array containing complete response objects.
Each input is limited to 8 MiB and 100 response objects. Invalid JSON, duplicate
object keys, non-finite numbers and invalid response structures are rejected.
A malformed member rejects its entire array before any writes for that input;
other valid files in the batch can still import. For repeated Options tickers,
the newest snapshot/asOf/gamma combination is selected first and other entries
for that ticker are skipped. Duplicate News keys are removed across the batch.

## Credentials and original payloads

Only existing backend credentials `PROJECT_URL` and `SERVICE_ROLE_KEY` from
repository-root `.env.local` are used to access Supabase. No browser cookie or
SaveTicker access token is needed. Frontend environment files are unchanged.
Do not paste cookies, credentials, request headers, or browser storage; paste
only the API JSON response body.

Before a real import, the complete original input (including extra Options
fields and `gammaUpdatedAt`) is saved under `.local-fallback/manual-imports/`.
On macOS the directory is private (`0700`) and each file is owner-only (`0600`).
The existing Git ignore covers this directory. Pasted content is visible during
interactive entry; credentials and response contents are not repeated in
validation or import reports. Dry-run and validate-only modes create no archive.
You may save downloaded JSON files in this directory to keep them Git-ignored.
Supabase receives the existing normalized schema, not the private raw archive;
website payloads and security remain unchanged.

## Data protection and scheduling

Options reads the current 19-ticker production allowlist. It reuses the existing
normalizer, `gammaPer1Pct` mapping, 15-minute cache freshness check, snapshot/asOf
comparison, gamma revision provenance and manual-data protection. Fresh data,
older/equal snapshots without a provably newer gamma revision, unknown ages,
and active Supabase refreshes are preserved. A second cache read and the
existing atomic compare-and-swap protect concurrent edits, including
payload-only manual edits. Missing rows use insert-with-ignore-duplicates.
Successful writes are read back before recording gamma provenance.

News uses the existing English translation, source, ID, timestamp, headline and
ticker normalization. Only Reuters and Financial Juice are eligible. Existing
source/ID pairs are always skipped; inserts ignore concurrent duplicates.
It never updates or deletes News rows. CNBC is excluded. Unlike the automated
fetch gate, a manual News import can add missing articles even when the source
is fresh, so pasting group 1 does not block an immediate group 6 import.
Original publication times are retained; old input cannot replace newer rows.

The importer shares the existing local run lock, acquired only after input is
complete. If the scheduled fallback is already running, it reports a busy lock
and you can try again later. Nothing stops or reschedules the LaunchAgent.
Manual imports can run at any time; the automatic Options fetch restriction
(weekdays 05:30–before 14:00 Pacific) and 900-second schedule are unchanged.
Supabase primary automation, RLS, Pro authorization and frontend are untouched.
