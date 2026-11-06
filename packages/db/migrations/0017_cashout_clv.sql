-- Cash-outs stored their price move in clv, which the CLV averages then counted. The move is
-- locked_odds / implied_current_odds - 1, so it is not lost.
UPDATE "bets" SET "clv" = NULL WHERE "status" = 'cashed_out';
