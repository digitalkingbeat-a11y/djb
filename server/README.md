# DJ Battle Server

Express server for authenticated DJ Battle contracts: score submission, private mix uploads, judging results, battle prep snapshots, battle-room sync, rankings, community, challenges, and relationship workflows.

## Setup

1. Install dependencies:

```bash
cd server
npm install
```

2. Configure Supabase environment variables:

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_KEY="your-anon-key"
export SUPABASE_SERVICE_KEY="your-service-role-key"
node index.js
```

3. Apply the SQL migrations in `server/sql` for the contracts you enable.

## Tests

```bash
npm test
```

The FFmpeg probe is optional and requires a working local FFmpeg binary:

```bash
npm run test:ffmpeg
```

## Notes

- Protected routes derive ownership from the verified Supabase token.
- Private audio paths and service credentials are never returned to public clients.
- Public result and leaderboard routes return sanitized rows only.
