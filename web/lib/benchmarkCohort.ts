// A cohort below this many distinct orgs is not written/served — with fewer
// orgs the "median" is effectively one org's own number, de-anonymizing them
// the moment they view /app/benchmark.
//
// The 'all' cohort used to be exempt, on the stated assumption that fleet-wide
// "is always large enough in practice". That assumption was never checked and
// was false: in production the fleet held ONE org, so fleet_median === the
// viewer's own value while the report still emitted a percentile and a grade.
// At two or three orgs it is worse than useless — the median IS another
// customer's exact error rate, which is precisely the disclosure this floor
// exists to prevent. Fleet-wide is not a different kind of cohort; it is the
// same kind with a wider filter, so it gets the same floor.
export const MIN_COHORT_ORGS = 20;

// Whether a cohort's fleet-stats row should be written/served this run.
export function shouldWriteCohort(_vertical: string, orgCount: number): boolean {
  return orgCount >= MIN_COHORT_ORGS;
}
