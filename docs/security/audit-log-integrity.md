# Audit Log Integrity

How Verixa's audit trail resists being quietly wrong: the hash chain, what it can and cannot prove, how entries are serialized into logs and exports without letting a recorded value speak for the record, and where retention stands today.

Related: `docs/security/threat-model-audit.md` (the threat model this document implements), `docs/adr/0003-stellar-audit-anchoring.md` (the external commitment), `docs/guides/stellar-anchoring.md` (operating the anchor).

---

## Two logs, one guarantee

`packages/audit` contains two append-only structures, and the difference is not decoration:

|              | `AuditEvent`                                                           | `AuditLogEntry`                                          |
| :----------- | :--------------------------------------------------------------------- | :------------------------------------------------------- |
| Purpose      | Structured facts about what happened, queryable by actor/resource/time | A chain where each record commits to its predecessor     |
| Identity     | `AuditEventId`                                                         | `sequence` + `hash`                                      |
| Integrity    | Immutability by API shape; no per-row digest                           | SHA-256 over a canonical pre-image, linked               |
| Metadata     | Validated against a per-action schema (`.strict()`)                    | Bounded flat string bag, length-prefixed into the digest |
| Written by   | Subscribers on domain events (185, 186)                                | `RecordAuditEvent` (184)                                 |
| Erasure path | Phase 24                                                               | Phase 24, with the anchored digest retained              |

An event tells you what happened. A chain entry tells you that nobody edited what happened. Both are append-only, and neither has an update or delete method — not because it would be hard to add one, but because a port that offered it would be used by someone in a hurry, and the chain would become decorative.

---

## The hash chain

Each entry's digest covers its own content **and** its predecessor's digest:

```
hash(n) = SHA-256( canonical( sequence, action, actorId, subjectId,
                             occurredAt, hash(n-1), metadata ) )
```

The first entry links to `GENESIS_HASH` (64 zeroes) rather than to nothing, so every entry's pre-image has the same shape and verification needs no special case.

`verifyChain` walks the entries and reports the **first** break, with a reason:

| Reason            | Meaning                                                 | Typical cause                                              |
| :---------------- | :------------------------------------------------------ | :--------------------------------------------------------- |
| `content_altered` | The entry's own hash no longer matches its content      | An edited row, or a canonical-form change nobody versioned |
| `link_broken`     | The entry is intact but does not follow its predecessor | A row deleted or moved between two that survived           |
| `sequence_gap`    | Numbering skips                                         | A removal whose links were also repaired                   |

Only the first break is reported deliberately. Everything after a break is unreliable _because of_ it, and listing the cascade would bury the one fact worth acting on.

### Recomputed, never trusted

`hasValidHash` derives the digest again from the stored columns rather than comparing a stored hash to itself. A stored hash that is merely read back proves nothing — whoever edited the row would edit the hash too. The check has meaning only because it is derived from content.

### The chain's limit, stated plainly

An attacker with write access to the table can recompute every hash from the point of their edit onward. The result verifies perfectly. Hash chaining makes the log tamper-**evident to someone holding an earlier hash**; it does not make it tamper-**proof**. Closing that gap requires a commitment somewhere the operator cannot rewrite, which is Issue 190A and ADR-0003.

---

## The canonical form, and why it is length-prefixed

The pre-image is versioned:

```
verixa-audit-v2 <field-count> <len>:<field>|<len>:<field>|...
```

…with `<len>` the **UTF-8 byte length** of each field, and metadata expanded as `<count>;<len>:<key>=<len>:<value>;…` with keys sorted.

The previous form joined fields with newlines. An explicit separator looks like it solves concatenation ambiguity, and it does not — the separator can appear _inside_ a field. `actorId` and `subjectId` are usually supplied from outside the process, so an entry with actor `"a\nb"` and subject `"c"` serialized identically to an entry with actor `"a"` and subject `"b\nc"`. Two different facts, one digest, which inverts the property the chain exists to provide. The same class of bug reappears wherever a value is embedded into a syntax by concatenation, so it is treated as a threat in its own right (T6 in the threat model).

A declared byte length makes everything inside a field part of that field's content. Nothing there can move a boundary.

Two details that are easy to get wrong:

- **Bytes, not characters.** The digest must be re-derivable years later from the stored columns by somebody not running this code. JavaScript's `.length` counts UTF-16 code units; `é` is 1 character, 2 bytes, and an emoji disagrees again. Byte lengths are the only number other runtimes will reproduce.
- **Sorted keys.** Otherwise insertion order changes the hash, and "same content, different digest" is the same failure in a subtler costume.

### Changing the form changes every digest

Bumping the version changes what a stored hash is compared against: entries written under the old form report `content_altered`. That is not a bug to code around — it is the correct reading of a digest that no longer matches its content. Any future change needs the version to move in the same commit, and needs a note about the historical chains it invalidates.

---

## Injection: bounds on input, escaping on output

Metadata is the only part of an entry an outside party usually controls, and it is written to four places that can each misread it: a database column, a hash pre-image, a compliance export, and the application log.

The rule that keeps those honest:

> **Bound what may enter. Neutralize at each boundary where text could be misread. Never rewrite what is stored.**

Sanitizing on input is the rejected alternative, and it is worse twice over: it silently changes the evidence (the hashed value stops being the supplied value), and it teaches the next reader that safety is a property of the _data_ rather than of each _encoder_ — so the next output path, added by someone who did not read this file, forgets to escape.

### On input: bounds (`AuditMetadata.create`)

| Bound            | Value         | Why                                                                                                                                   |
| :--------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------ |
| Fields per entry | 32            | A bag with 10,000 keys is an unbounded write amplified into a hash, an index, and an export cell                                      |
| Key length       | 64            | Keys are column-ish names; longer means something else is being smuggled                                                              |
| Value length     | 1024          | Every output has to finish sometime                                                                                                   |
| Value type       | `string` only | Coercing `true`/`"true"` makes them indistinguishable in a query; accepting an object puts `JSON.stringify` shapes into a flat column |

Bounds are checked on input because a bound cannot be imposed later — by the time an exporter is writing a cell, the oversized bag is already the record.

When a bag fails, `RecordAuditEvent` still appends the entry, replacing the metadata with `metadataRejected: <reason>`, where the reason comes from a closed set of strings. Dropping the record is the outcome an attacker wants. A rejected _value_ is never echoed — the message names the bound and the value's type. A rejected _key_ is named, because a caller cannot tell which field broke the bound otherwise, but it is truncated and escaped first, so neither can be used to reflect unsanitized input into a log line.

### On output: one encoder per sink

| Sink                                                    | Treatment                                                          | Why that and not more                                                                                                                                                                                                                                                                                                         |
| :------------------------------------------------------ | :----------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored column / JSON                                    | Verbatim values                                                    | JSON escapes what it encodes; rewriting here destroys evidence for no benefit                                                                                                                                                                                                                                                 |
| Hash pre-image                                          | Length-prefixed canonical form                                     | Structure cannot be re-shaped by content                                                                                                                                                                                                                                                                                      |
| Log fields (`toLogFields`, `AuditMetadata.toLogFields`) | `escapeForText`: control characters and `\` become visible escapes | A `\n` would end a record early; `\t` and `\r` are cell and field separators to various tools. Escaping backslash too keeps the map one-to-one, so a reader can reconstruct what was supplied                                                                                                                                 |
| JSON documents inside text                              | `escapeJsonLineTerminators`, never `escapeForText`                 | JSON.stringify already escapes U+0000–U+001F. It leaves NEL (U+0085) and U+2028/U+2029 raw, and Python's `str.splitlines` treats those as line endings. Running the text escaper over a JSON _document_ instead escapes the backslashes JSON uses for its own escaping, and the result is neither JSON nor the original value |
| CSV cell                                                | Escape, then quote per RFC 4180, then neutralize a formula prefix  | Quoting alone does not help: Excel evaluates a _quoted_ cell beginning `=`. The classic payload is `=cmd\|'/c calc'!A1`; the attacker does not need the server, only whoever opens the file                                                                                                                                   |

`AuditLogEntry.toLogFields()` is what makes the export's central guarantee provable: **one entry, one line**. Its output cannot contain a character a line-oriented reader would act on, so the number of lines in a file is its record count — the fact an auditor checks by counting, and the one an injected newline destroys.

### Structured logging (following the Issue 008 redaction pattern)

Values go in **fields**, never in the message:

```ts
logger.info({ type: "audit.log.exported", recordCount, filters }, "audit export");
```

`logger.info(\`exported ${count} rows for ${JSON.stringify(filters)}\`)` reads better and is the bug. pino escapes its fields; a message is a message, so a newline inside a filter value lands verbatim and starts a line the application never logged:

```
[2026-10-02T00:00:00.000Z] INFO audit: exported 1 rows for {"actorId":"x
[2026-10-02T00:00:00.000Z] INFO audit: admin login granted"}
```

Nobody grepping that file afterwards can tell the injected line from a real one.

### Export formats

`ExportAuditEvents` writes either:

- **`jsonl`** — one JSON document per entry, values exactly as recorded. What a program should read, what re-verification should run against.
- **`csv`** — RFC 4180 quoting, escaped control characters, neutralized formula prefixes, and metadata as a single JSON column that still parses.

Both carry `hash` and `previousHash`, so an export can be verified against an anchored digest without a database.

Every export is capped (`DEFAULT_EXPORT_MAX_RECORDS`) and reports `truncated`. A silently partial compliance file is worse than a refused request: the row count _was_ the evidence. Authorization is not part of this use case — it has no notion of a requesting principal, deliberately, so no call site can half-implement a policy. That is Issue 199.

---

## Retention

Issue 192 ships the **evaluation seam and nothing else**. `ApplyAuditRetentionPolicy` walks the log with a `RetentionPolicy` (default: seven years, `AgeRetentionPolicy`) and returns the entries past the cutoff, the sequence it evaluated through, and `disposition: "identified_only"`.

It deletes nothing, archives nothing, and touches no row. `AuditLogRepository` has no delete method, and that is deliberate. Consequences worth writing down:

- **Archival cannot be bolted on later.** Moving a row out of the table makes `verifyChain` report a gap, and "the log is broken" is not an acceptable answer for a legal hold. The design has to decide _before_ deletion exists.
- **Erasure and anchoring disagree.** The chain head may already be committed to Stellar, so content can be erased while the digest stays public. The expected Phase 24 shape: erase content, keep the anchored digest, and append an explicit erasure entry so removal is visible rather than mysterious.
- **The seam is where a policy becomes reviewable.** "Which entries would go?" is a question that can be asked, logged, and argued about in advance — which is the entire value of a hook that does nothing else.

---

## Proving it

The behaviours above are pinned by tests that fail without the code:

- `domain/entities/audit-log-entry.spec.ts` — editing, deleting, tail-truncating, and the digest-ambiguity fixtures (a newline in one field must not shift a boundary into the next).
- `domain/value-objects/audit-metadata.spec.ts` — adversarial fixtures, bound rejections, canonical-form framing, one-to-one escaping.
- `application/use-cases/export-audit-events.spec.ts` — the full round trip: storage → query → export → structured logging, with a CSV parser independent of the writer.
- `application/use-cases/apply-audit-retention-policy.spec.ts` — that the review identifies candidates and changes nothing.

Read those fixtures as the catalogue of attacks this design answers. If you add an output path that is not in the table above, add it to the catalogue.
