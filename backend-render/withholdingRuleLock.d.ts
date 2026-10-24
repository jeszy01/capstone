type RuleLike = { id: string; effectiveFrom: string; effectiveTo?: string; tables?: unknown; annualTable?: unknown; annualBenefitsExemption?: number; paidLeaveAs?: string };
type RunLike = { status?: string; to: string; settings?: { withholdingRuleId?: string } };
export function ruleIdForRun(run: RunLike, rules: RuleLike[]): string | undefined;
export function lockedRuleChange(before: RuleLike[] | null | undefined, after: RuleLike[] | null | undefined, runs: RunLike[] | null | undefined): string;
