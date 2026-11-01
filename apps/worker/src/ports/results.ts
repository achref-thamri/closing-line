export type ResultStatus = "finished" | "pending" | "called_off";

export interface MatchResultInfo {
    kickoff: Date;
    /** The team's names in the source, e.g. full and short. */
    home: string[];
    away: string[];
    status: ResultStatus;
    /** Goals after regular time (90 minutes plus stoppage), as 1X2 bets are settled. */
    homeGoals: number | null;
    awayGoals: number | null;
}

/** Final scores for a competition between two dates (inclusive). */
export interface ResultsSource {
    results(competition: string, from: Date, to: Date): Promise<MatchResultInfo[]>;
}
