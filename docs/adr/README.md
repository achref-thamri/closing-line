# Architecture decision records

Each record states the context, the decision and its consequences, so later changes can weigh the same trade-offs.

| #                                                     | Decision                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| [0001](0001-schedule-with-a-minute-planner.md)        | Schedule jobs with a minute planner over the database              |
| [0002](0002-postgres-with-pglite-in-tests.md)         | PostgreSQL in production, PGlite in tests and local runs           |
| [0003](0003-pinnacle-as-the-fair-price.md)            | Pinnacle's de-vigged prices as the fair reference                  |
| [0004](0004-credit-guard.md)                          | A credit guard in front of every paid API call                     |
| [0005](0005-typescript-without-a-build-step.md)       | Run TypeScript without a build step                                |
| [0006](0006-closing-line-from-our-own-snapshot.md)    | The closing line from our own last Pinnacle snapshot               |
| [0007](0007-dashboard-reads-the-database-directly.md) | The dashboard reads the database directly, with SQL doing the sums |
| [0008](0008-edge-threshold-from-the-back-test.md)     | A 2% edge threshold, chosen by back-testing past seasons           |
