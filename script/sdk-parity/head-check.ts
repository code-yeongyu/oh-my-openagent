// The gate compares the pull request's own head (review 6061267823 H4), never a synthetic merge commit: the digest a
// reviewer copies is bound to that head, so a checkout of any other commit is refused before anything is compared.
export const headRefusal = (checkedOut: string, expected: string | undefined): string | undefined =>
  expected === undefined || checkedOut === expected
    ? undefined
    : `sdk-parity gate: checked out ${checkedOut}, not the pull request head ${expected}; check out the head itself\n`
