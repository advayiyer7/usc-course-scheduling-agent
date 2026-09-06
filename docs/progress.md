# Implementation evidence

## Milestone 1: ingestion and persistence

- TypeScript, npm, Zod input/source schemas, immutable snapshots, raw response provenance, aliases, sections, meetings and job queue.
- Shared request pacing, bounded retries, fenced worker lease and atomic publication.
- PostgreSQL adapter and Compose setup; embedded PostgreSQL via PGlite for single-process local development and tests. This additional dev dependency avoids requiring Docker to run the prototype. It is not a multi-user production database deployment.
- Imported the September 6 Fall 2026 archive: 245 program pairs, 4,637 normalized scheduled course identities, 9,537 sections. The earlier 4,653 count refers to published codes; aliases are retained.
- Six initial tests passed: incomplete/invalid coverage, immutable snapshots and compare-and-swap, alias preservation, 100 concurrent enqueue requests coalescing into one job, lease exclusion, retry and access-denial handling.
- No production service, external assistant-host onboarding or extension published.
