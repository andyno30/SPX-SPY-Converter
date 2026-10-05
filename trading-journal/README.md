# Trading journal

The page is `/trading-journal.html`. Its separate Vercel project uses this directory as its root. It does not use `news-app`.

Images and entries live in `public/journal/` in GitHub. Publishing verifies the existing Supabase login with `/auth/v1/user`, then atomically commits journal files to `main`. No Supabase database, storage, policies, or service-role key are used. Only the verified account `andyno30@gmail.com` can publish. Visitors read the deployed JSON and images; a new entry becomes public after Vercel deploys the commit.

Vercel project: `spyconverter-journal`; framework: Other; root directory: `trading-journal`. Environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`: the existing site's Supabase URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the existing site's public publishable key.
- `JOURNAL_GITHUB_TOKEN`: a server-only fine-grained GitHub token, restricted to `andyno30/SPX-SPY-Converter`, with Contents read/write. Never put it in browser code or Git.

The token is required before the editor can save. Images are limited to 3 MiB each (up to 10 per entry) to fit Vercel's request limit. Images are retained in Git history even when removed from an entry; do not publish sensitive screenshots. Concurrent edits to the same entry are rejected; unrelated commits are preserved without force pushes.
