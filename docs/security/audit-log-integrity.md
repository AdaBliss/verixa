# Audit Log Integrity

How Verixa keeps the audit log trustworthy — and, in this revision, how it
stops the audit log from becoming the easiest way to leak what it records.

This document is shared by several Phase 10 issues. The hash-chain,
verification and retention sections belong to Issues 183, 190, 191 and 192 and
will be added as those land; the section below is Issue 199's.

## Reading the audit log is a privileged, audited action

Implementation:
`packages/audit/domain/policies/audit-access-policy.ts` (the rules),
`packages/audit/application/audit-read-access.ts` (authorize-then-record),
`packages/audit/application/use-cases/query-audit-events.ts` and
`packages/audit/application/use-cases/export-audit-events.ts`.

### The rule

**Every read of an organization's audit log requires an explicit permission
within that organization, is refused for any other organization, and is itself
written to the audit log before a single entry is returned.**

### Why: the log is the most concentrated record in the system

An audit log answers "who did what, when, to whom" for an entire organization.
That is precisely what an attacker doing reconnaissance wants, and precisely
what a curious insider should not be able to browse. A system that protects
every individual record and then exposes the log of all of them has moved the
leak, not closed it.

Two failure modes matter, and they need different controls:

- **Unauthorized reads** — someone without a reason reads the log, or reads
  another tenant's. Closed by the permission check and the organization check.
- **Unobserved authorized reads** — someone with access uses it in a way
  nobody would sanction. No access check can stop this, because the access is
  legitimate. What stops it is that the read is recorded where the people
  reviewing access will see it. This is the "who audits the auditors" property
  compliance frameworks expect (SOC 2's monitoring criteria, ISO 27001 A.8.15),
  and it is the reason the self-record is not optional.

### Two permissions, not one

| Permission     | Grants                                                  |
| :------------- | :------------------------------------------------------ |
| `audit:query`  | A bounded page (at most `MAX_AUDIT_QUERY_PAGE_SIZE`)    |
| `audit:export` | A stream of the entire filtered history, for a download |

Export is bulk disclosure: the result leaves the system as a file and nobody
can take it back. Folding it into `audit:query` would mean everyone trusted to
look something up is trusted to walk away with everything. For the same
reason, the query page size is capped — without the cap, `limit: 10_000_000`
is an export reached with the weaker permission, and the two grants stop
meaning different things.

### Cross-organization requests are refused, not quietly rescoped

The alternative we rejected was to ignore the requested organization and
answer from the caller's own. It looks safe — no foreign data is ever
returned — but it turns an attempt to read another tenant's log into a
successful, unremarkable request. Nothing distinguishes the operator who
mistyped from the one probing tenants. Refusing makes the attempt an event,
and it is recorded as one (`audit.access_denied`, with the reason and the
caller's own organization).

The refusal message is identical whatever the reason. Telling a caller "that
organization is not yours" versus "you lack the permission" confirms which
organization IDs are real — the same enumeration reasoning as
[Authentication Flows](authentication-flows.md). The reason is kept on the
error for the audit record and deliberately left out of its serialized form.

There is no implicit "platform administrators may read every tenant" bypass.
When cross-tenant access is genuinely needed (Phase 16's admin tooling), it
should arrive as its own separately-granted permission, checked in
`authorizeAuditRead` where review will see it. Implicit bypasses are the
rules that end up applying to more people than intended.

### Recorded before the data is released, and fail closed

Both use cases write their `audit.queried` / `audit.exported` entry _before_
reading, and refuse with `AUDIT_READ_NOT_RECORDED` (503) if that write fails.

This is the opposite of what `RecordAuditEvent` does everywhere else, and the
difference is deliberate. When a login is audited, the login has already
happened; failing it because the audit write failed would report a false
negative to the user, so audit writes there are best-effort. A read of the
audit log has not happened yet. Refusing it costs one retry. Serving it anyway
would mean the reliable way to read the audit log unobserved is to break audit
writes first — which is exactly the attacker an audit log exists to catch.

For exports specifically, the record is written when the export _starts_, not
when it finishes. "Log a successful export on completion" reads more
naturally, but it gets the security property backwards: rows leave the system
from the first chunk, and a client that disconnects one row before the end
would have taken almost everything while leaving no trace. What is audited is
the disclosure, and the disclosure begins immediately.

Refusals, by contrast, are recorded best-effort. The caller is refused either
way, so failing to record the refusal cannot change the outcome.

### Pending: where permissions come from

Until Phase 07's RBAC is wired into the API (Phase 12), nothing in the running
application grants `audit:query` or `audit:export`. The use cases take an
`AuditReader` — actor, organization, and the permissions held _within that
organization_ — built by the interface layer from the authenticated session,
never from the request body. The composition root is responsible for
populating `permissions` from whatever resolves them; until it does, the set is
empty and every read is refused. That is the correct default: an audit API
that is unreachable until authorization exists is a missing feature, while one
that is reachable before authorization exists is a breach.

### Where scoping is enforced

`AuditEventReader` (`packages/audit/application/ports/audit-event-reader.ts`)
takes the organization as a required criterion, and the use cases fill it from
the _authorized_ organization rather than passing caller input through. An
adapter therefore never sees an unscoped read. It is a separate port from
`AuditLogRepository` for the same reason: that port must stay unscoped to
append to and verify the whole chain, and giving query callers access to it
would hand them a method that ignores tenancy.

### Tests

- `packages/audit/domain/policies/audit-access-policy.spec.ts` — the rules,
  including that one permission cannot stand in for the other and that the
  serialized refusal is identical for every reason.
- `packages/audit/application/use-cases/query-audit-events.spec.ts` and
  `export-audit-events.spec.ts` — cross-organization rejection without
  touching storage, the self-record written with actor, organization and
  filters, the export recorded before its stream is consumed, fail-closed
  behaviour when the record cannot be written, and the page-size cap.
Verixa's audit log is **append-only and hash-chained**, and it is anchored
periodically to a public ledger. Those are two different guarantees, obtained
by two different mechanisms, and neither one is sufficient on its own. This
document says what each of them buys, what it does not, and how to actually
run the check.

## The threat this is written against

Not an outside attacker. Someone with **write access to the audit table**: a
compromised application role, a disgruntled operator, a support engineer with
production access, or the software itself after a bug. Their goal is not to
steal the log but to make a particular evening look quiet.

A plain table of rows cannot defend against that. `DELETE FROM audit_log_entry
WHERE occurred_at BETWEEN ...` leaves no evidence it happened. Every
guarantee below exists to answer that one adversary.

## Guarantee 1 — chaining (tamper-evident to a witness)

Each entry commits to its predecessor:

```text
hash = SHA-256(sequence ‖ action ‖ actorId ‖ subjectId ‖ occurredAt ‖
                previousHash ‖ sorted metadata)
```

The first entry links to `GENESIS_HASH`, sixty-four zeroes, so the shape of
every entry's digest is identical and verification needs no special case
(`packages/audit/domain/entities/audit-log-entry.ts`).

The canonical form is deliberately reproducible by someone re-deriving it years
later from the stored columns, possibly in another language: field order is
fixed, metadata keys are sorted, and fields are newline-separated with the
count implied by the schema rather than concatenated, so no combination of
values can produce the same bytes as a different combination.

**What this catches.** Editing one row. The recomputed digest no longer matches
the stored one, and the check only means anything because it _recomputes_ —
trusting the stored hash would prove nothing, since whoever edits a row edits
its hash too.

**What this does not catch.** Deleting a row, or rewriting the log from any
point forward. A rewritten chain is internally consistent and indistinguishable
from an honest one. Chaining makes tampering evident **to someone who already
holds an earlier hash**; it does not make tampering impossible.

That distinction is worth stating plainly, because "we hash-chain our audit
log" is routinely claimed as though it were the whole answer. It is half of it.

Deletion is caught in the two ways it can be: an entry that no longer links to
its neighbour (`link_broken`), and a counter that skips (`sequence_gap`). Both
are reported by verification, below.

## Guarantee 2 — anchoring (tamper-evident to anyone)

Anchoring closes the gap chaining leaves, by moving a commitment somewhere the
operator cannot rewrite. Periodically the current chain head hash is written
into a Stellar transaction (ADR 0003, `docs/adr/0003-stellar-audit-anchoring.md`,
and `docs/guides/stellar-anchoring.md`).

Only the hash goes on-chain. The log's contents stay in the operator's database
and must — publishing audit content to a public ledger would be an irreversible
leak, and audit records are exactly the records most likely to contain
something sensitive. A digest proves the records existed, unchanged, while
revealing nothing about them.

Anchoring is periodic rather than per-entry because the chain already links
entries to one another: committing the head commits to everything beneath it at
once. The interval is the operator's knob — it bounds the window in which
tampering can go undetected to the time since the last anchor.

## Verification

A property nobody can invoke is not a control. Tamper-evidence only bites when
someone actually re-hashes the log and compares.

### Running it

```bash
pnpm audit:verify-chain
```

That builds the workspace packages the tool depends on and runs
`packages/audit/infrastructure/cli/verify-chain.ts`. It needs a `DATABASE_URL`
and nothing else — no secret key, no credentials.

```text
Usage:
  verify-chain [options]

Options:
  --from <sequence>        First entry to verify (default: 1, the whole chain)
  --to <sequence>          Last entry to verify (default: the chain head)
  --organization <id>      Report how many verified entries belong to this organization
  --batch-size <n>         Entries per query, 1-5000 (default: 500)
  --check-anchors          Confirm anchored ranges against the public ledger
  --limit-anchors <n>      Receipts to consult with --check-anchors (default: 20)
```

Typical invocation, as a nightly job or a deploy gate:

```bash
DATABASE_URL="$DATABASE_URL" pnpm audit:verify-chain || alert "audit chain broken"
```

**Exit status is the machine-readable answer**: `0` when the verified range is
intact and no consulted receipt disagrees, `1` when the chain is broken, a
receipt disagrees, or the check could not run at all. Read the status, not the
prose.

Example output:

```text
chain verification: BROKEN
  range:     1-4
  entries:   2 checked
  head hash: 3f8a…
  first break at sequence 2: content_altered
  anchor @4 (stellar:testnet 5f0c…): database matches, ledger matches
```

### The same check, in process

`VerifyAuditChain` is wired into the API's container as
`container.audit.verifyChain`, so a scheduler or an admin endpoint can run it
without spawning a process. The CLI is that use case with argument parsing and
a report attached; there is no second implementation of the walk to drift.

```ts
const result = await container.audit.verifyChain.execute({
  fromSequence: 1,
  batchSize: 1_000,
  checkAnchors: true,
});

if (Result.isOk(result) && !result.value.valid) {
  report(result.value.firstBreak);
}
```

### Reading the result

| Field                    | Meaning                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `valid`                  | The verified range is intact. False exactly when `firstBreak` is set.                              |
| `checkedEntries`         | Entries actually inspected — not merely fetched. A log broken at sequence 2 reports 2, not 10,000. |
| `headHash`               | Head of the verified range. This is the value an anchor commits to.                                |
| `seededFromWindowStart`  | True when the run began partway into the chain, so the reader knows it did not look at genesis.    |
| `organizationEntryCount` | How many inspected entries carry that `organizationId`. See the tenancy note below.                |
| `firstBreak.reason`      | `content_altered`, `link_broken`, or `sequence_gap`.                                               |
| `anchorChecks`           | One row per receipt consulted, with what each side said.                                           |
| `anchorsSkipped`         | `--check-anchors` was asked for but no ledger is wired. Reported, not silently empty.              |

The three break reasons describe three different attacks:

- `content_altered` — an entry's content no longer matches its own digest.
  Someone edited a field.
- `link_broken` — the entry is intact but does not follow its predecessor.
  Someone removed a row.
- `sequence_gap` — the numbering skips. Someone removed a row _and_ repaired
  the links, but not the counter.

Only the **first** break is reported. Everything after a break is unreliable as
a consequence of it, and listing the cascade would bury the one fact that
matters under noise the break itself caused.

### Anchored ranges

With `--check-anchors`, the last N receipts are compared against two
independent sources:

```text
anchor @1204 (stellar:testnet 5f0c…): database matches, ledger MISMATCH
```

| `matchesDatabaseChain` | `matchesLedger` | What it means                                                                                                                                                               |
| ---------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| true                   | true            | This database reproduces the hash the public ledger holds. The strongest statement available.                                                                               |
| false                  | true            | The ledger still commits to what was published, and this database no longer produces it. **History was rewritten after it was anchored.** Report it as an incident.         |
| true                   | false           | The receipt is wrong: no such commitment exists on the ledger. Either the anchor never landed or `anchor_ref` was edited.                                                   |
| false                  | false           | Both disagree. Assume the local log and the receipt are both untrustworthy.                                                                                                 |
| `undefined`            | `undefined`     | The receipt's sequence fell outside the verified range. Absence of evidence, deliberately not reported as a mismatch — a narrow run must not raise a false tampering alarm. |

The ledger lookup is deliberately a **separate port** (`AnchorVerifierPort`)
from the anchoring port. Verification reads public data and signs nothing, so
it needs no secret key: the CLI constructs a throwaway keypair, exactly as
`packages/stellar-anchor`'s own `verify` command does. A third party with
nothing but a hash and a transaction reference can run the same check — see
`docs/guides/stellar-anchoring.md`. That is the point of anchoring externally
rather than to a second database the operator also controls.

If the ledger could not be reached at all, `ledgerError` is set and
`matchesLedger` stays `undefined`. A failed lookup is a third answer and must
not be recorded as either of the other two.

### Tenancy

`--organization` reports how many verified entries belong to a tenant. It does
**not** restrict the walk, and this is not an oversight.

`sequence` is global, and each entry's `previousHash` is the entry before it
regardless of tenant. A filtered subsequence is not a chain: skipping the rows
in between breaks every link, so an organization-only walk would report
tampering in a perfectly honest log. Building per-tenant chains would need a
per-tenant counter and a per-tenant head to anchor, which is a different design
with its own ADR. Verification therefore walks everything and reports
membership alongside integrity.

### Limits, stated plainly

- **Verification needs the rows.** Re-deriving hashes requires reading the
  entries, so a third party cannot check the log's contents from the anchor
  alone. What they can check independently is any given digest — "does this
  hash appear in this transaction" — which is what makes the anchor honest.
- **A window is not proof.** `--from 5000 --to 6000` says nothing about a break
  at sequence 4. `seededFromWindowStart` is there so the result cannot be
  misread as a clean bill of health for the whole log.
- **A wholesale rewrite of the tail verifies.** That is what anchoring is for,
  and it is covered by an explicit test rather than left as a footnote.
- **`--check-anchors` reaches the network.** Use it where a Horizon endpoint is
  reachable; without one, the receipts are still compared against the local
  chain and a lookup failure surfaces as `ledgerError`.

## How this is tested

- Unit: `packages/audit/domain/entities/audit-log-entry.spec.ts` (chaining, the
  three break shapes, and the wholesale-rewrite limit) and
  `packages/audit/application/use-cases/verify-audit-chain.spec.ts` (windows,
  batching, tenancy, and anchor comparison against a stand-in ledger).
- Postgres-backed: `tests/integration/audit-chain-verification.spec.ts`
  re-derives hashes from rows written by the production append path, then
  corrupts them with raw `UPDATE` and `DELETE`, and runs the CLI as a
  subprocess. This is where a mapper, a JSON column, or timestamp precision
  could make an honest log report itself as tampered.
- The package runs under a coverage gate (Issue 138) so the walk's branches
  cannot silently stop being exercised: an untested branch in verification is a
  security property that quietly does not hold.

Database-backed specs skip when no Postgres is reachable, and CI sets
`REQUIRE_DATABASE_TESTS=1` so a skip becomes a failure rather than a green run
that checked nothing.
