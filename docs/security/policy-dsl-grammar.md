# Policy DSL grammar

This document defines the small expression language used to describe ABAC
policies. It deliberately handles expressions rather than declarations,
variables, or arbitrary code: authorization rules need to be readable and
auditable, and a constrained grammar makes their meaning predictable.

## Grammar

The grammar is EBNF. Terminals in quotes are literal tokens; `#` starts a
comment through the end of a line. Keywords are case-sensitive.

```ebnf
policy       = effect, "if", expression ;
effect       = "permit" | "deny" ;
expression   = disjunction ;
disjunction  = conjunction, { "or", conjunction } ;
conjunction  = negation, { "and", negation } ;
negation     = [ "not" ], comparison ;
comparison  = primary, [ comparison-op, primary ] ;
comparison-op = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in"
              | "contains" | "matches" ;
primary      = literal | attribute | "(", expression, ")"
              | function-call ;
function-call = identifier, "(", [ arguments ], ")" ;
arguments    = expression, { ",", expression } ;
attribute    = bag, ".", identifier, { ".", identifier } ;
bag          = "subject" | "resource" | "action" | "environment" ;
literal      = string | number | "true" | "false" | "null"
             | date | array ;
array        = "[", [ literal, { ",", literal } ], "]" ;
string       = '"', { escaped-character | non-quote-character }, '"' ;
number       = [ "-" ], digit, { digit }, [ ".", digit, { digit } ] ;
date         = "date(", string, ")" ;
identifier   = letter, { letter | digit | "_" } ;
```

Attribute paths start with one of the four standard ABAC bags. Further path
segments are resolved as nested object properties by the attribute context;
missing segments evaluate as missing values. A date literal is an ISO-8601
string wrapped in `date(...)`, validated as a date when parsed. Arrays contain
literals only, which keeps membership checks deterministic and avoids hidden
evaluation in data literals.

## Operators and precedence

From highest to lowest precedence:

| Precedence | Operators | Associativity |
| --- | --- | --- |
| 1 | parentheses, function calls, attribute access | left to right |
| 2 | `not` | right to left |
| 3 | `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `contains`, `matches` | non-associative; chain comparisons with `and` |
| 4 | `and` | left to right |
| 5 | `or` | left to right |

`and` binds more tightly than `or`, so `a or b and c` means `a or (b and c)`.
Comparisons do not chain: `a < b < c` is invalid. Use
`a < b and b < c` to make the intent explicit. `matches` takes a string on the
right and interprets it as a regular expression; invalid patterns are rejected
when a policy is parsed. Operators do not coerce types: equality between
different types is false (and inequality is true), while ordering, membership,
containment, and matching with incompatible types evaluate false.

## Attribute model

An attribute reference is `bag.name` or a nested path such as
`resource.owner.id`:

| Bag | Meaning | Typical values |
| --- | --- | --- |
| `subject` | Principal making the request | `id`, `orgId`, `roles`, `emailVerified` |
| `resource` | Object being accessed | `ownerId`, `orgId`, `status`, `availableFrom` |
| `action` | Operation being requested | `name`, `resource`, `method` |
| `environment` | Request and execution context | `now`, `ip`, `userAgent`, `requestId` |

All bags are typed maps. Supported values are strings, finite numbers,
booleans, dates, arrays, and nested records made from those values. Looking up
a missing path produces an undefined value; it never throws. Evaluation of a
comparison involving a missing value is false, including `!=`, so missing
information cannot accidentally grant access. `not` applies to boolean
expressions and follows the same fail-closed rule when its operand cannot be
evaluated.

## Functions

Functions are deliberately allowlisted by the evaluator. The initial helper is
`between(value, start, end)`, an inclusive comparison (`start <= value <= end`)
for date or number values. It supports time-window policies without embedding
the system clock: policies compare an explicit `environment.now` attribute,
which request construction supplies from the application's clock port. Unknown
functions, wrong arity, invalid dates, and malformed regex patterns are
rejected during parsing.

## Attribute sourcing

The evaluation engine consumes an `AttributeContext`; it does not fetch data.
An application-layer `AttributeProvider` contributes context bags from one
source. Providers run in registration order and later values override earlier
values at the same path. Register trusted server-derived data after
request-supplied claims so callers cannot overwrite verified identity or
resource facts. A provider declares whether failure is `fail-open` or
`fail-closed`: optional enrichment can be skipped, while a source required for
an authorization invariant must fail the resolution. The pipeline preserves
that distinction and never silently treats a failed required source as an
empty bag.

## Examples

Each example is a complete policy expression after the `if` keyword.

1. **Resource ownership:** `permit if resource.ownerId == subject.id`
2. **Read-only access:** `permit if action.name == "read"`
3. **Organization boundary:** `permit if resource.orgId == subject.orgId`
4. **Verified account:** `permit if subject.emailVerified == true`
5. **Active resource:** `permit if resource.status == "active"`
6. **Organization admin:** `permit if subject.roles contains "org-admin" and resource.orgId == subject.orgId`
7. **Time window:** `permit if between(environment.now, resource.availableFrom, resource.availableUntil)`
8. **Business hours:** `permit if environment.hour >= 9 and environment.hour < 17`
9. **Network allowlist:** `permit if environment.ip in ["192.0.2.10", "192.0.2.11"]`
10. **Sensitive action requires MFA:** `permit if action.name != "delete" or subject.mfaSatisfied == true`
11. **Deny suspended subjects:** `deny if subject.status == "suspended"`
12. **Nested resource owner:** `permit if resource.owner.id == subject.id and action.name == "update"`

These examples use `environment.now` and other request facts as explicit
attributes. This keeps decisions reproducible in tests and audit replays: the
same context always produces the same result.
