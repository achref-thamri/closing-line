# Betting Bot

A paper-betting system for European football. A human expert and a market-based value scanner each bet with
virtual money, and every bet is measured against the closing line, the market's most accurate price. Real money
only follows a track record that clears rules fixed in advance.

> Work in progress. Phase 1: monorepo skeleton, odds maths, value scanner.

## Structure

```
apps/        worker (jobs, Telegram), web (dashboard)
packages/    core (pure betting maths), db (Postgres schema and repositories), config
```

## Getting started

Requirements: Node 24 (`.nvmrc`) and pnpm (via Corepack).

```sh
pnpm install
pnpm check      # format, lint, typecheck, tests
```

Not betting advice. This is a personal project.

## License

[MIT](LICENSE)
