# Policy DSL Grammar

This document is the reference for `packages/authorization`'s ABAC policy
DSL — grammar, attribute sourcing, evaluation semantics, and operators. It
grows section by section as later Phase 08 issues land (the grammar itself
is Issue 142, the parser Issue 143, the attribute model Issues 144-145, the
evaluator Issue 146, operators Issue 147). Resource-attribute resolution
(Issue 151) is documented below since its implementation exists ahead of
the sections it depends on.

## Resource-attribute resolution

A policy condition can reference a resource's own attributes — `resource.ownerId`,
`resource.sensitivity`, `resource.status` — but `packages/authorization` has
no schema for a `document` or a `verificationCase`; those belong to
`packages/verification`, `packages/governance`, and every other bounded
context that owns a resource type policies might target.

`ResourceAttributeResolverRegistry`
(`packages/authorization/application/services/resource-attribute-resolver-registry.ts`)
is the seam that resolves this without creating a dependency in either
direction beyond the one port:

```ts
import type { ResourceAttributeResolver } from "@verixa/authorization";

// Implemented inside packages/verification, not packages/authorization.
const verificationCaseResolver: ResourceAttributeResolver = {
  async resolve(resourceId) {
    const verificationCase = await verificationCaseRepository.findById(asId(resourceId));
    return {
      ownerId: verificationCase.ownerId,
      status: verificationCase.status,
    };
  },
};

// Registered from composition-root wiring (Issue 157), once at startup.
registry.register("verificationCase", verificationCaseResolver);
```

At evaluation time, the engine (Issue 146) calls
`registry.resolve("verificationCase", resourceId)` and gets back a plain
`ResourceAttributes` map — it never imports anything from
`packages/verification` itself. This is the dependency direction
`ARCHITECTURE.md` §4 requires: contexts that own resources depend on and
register with `packages/authorization`; `packages/authorization` never
depends on them.

### Why a registry, not a lookup table of imports

The alternative — `packages/authorization` importing each context's
repository directly and switching on resource type — would work, but it
inverts the dependency graph specified in `ARCHITECTURE.md` §4: the
authorization context (which every other context needs to call into for
`AuthorizeAction`, Issue 153) would end up depending on all of them,
creating exactly the import cycle that architecture forbids. The registry
pattern keeps `packages/authorization` at the bottom of the dependency
graph: it defines a port, and everyone else implements and registers
against it.

### Unknown resource types fail loudly

`registry.resolve(resourceType, resourceId)` throws
`UnknownResourceTypeError` — naming the unresolved `resourceType` — rather
than resolving to `undefined` or an empty attribute set. A policy silently
evaluating with no resource attributes at all is a much more dangerous
failure mode than an exception: depending on how the policy is written, an
empty attribute set can make a `DENY` rule fail to match and fall through to
an unrelated `PERMIT`, silently over-granting. Registration bugs (a new
resource type added to a policy target without a matching resolver
registered anywhere) should surface immediately in tests and staging, not
manifest later as an authorization bug that looks like correct code
enforcing an incorrect policy — see `docs/security/threat-model-abac.md`
(Issue 159) once it exists.

### Registering twice for the same resource type

`register` overwrites rather than throwing on a duplicate registration for
the same resource type. Composition-root wiring runs once, in a fixed
order, at process startup — a second registration in that context is far
more likely to be a deliberate override (test setup swapping in a fake
resolver) than a bug worth crashing startup over.

## Attribute model

`AttributeContext` (`packages/authorization/domain/value-objects/attribute-context.ts`,
Issue 144) is the shape every condition is evaluated against: four typed
bags — `subject`, `resource`, `action`, `environment` — the same
categorization NIST SP 800-162 uses, so the vocabulary is legible to anyone
who already knows ABAC theory.

```ts
const context = AttributeContext.create({
  subject: { id: "user-1", role: "admin" },
  resource: { ownerId: "user-2", sensitivity: "high" },
  action: { name: "read" },
  environment: { requestedAt: new Date() },
});

context.get("subject", "role"); // "admin"
context.get("subject", "nonexistent"); // undefined — never throws
context.resolve("resource.ownerId"); // "user-2" — the dotted-path form Condition.comparison's `attribute` field uses
```

A missing attribute resolves to `undefined`, never throws — both `get` and
`resolve` are total functions over any category/key or dotted path,
including one that names a category nothing supplied a bag for (it's simply
empty) or doesn't match any of the four categories at all (`resolve`
returns `undefined` rather than guessing). This is what lets the evaluation
engine below treat "attribute wasn't supplied" as an ordinary, defined
outcome (a comparison that evaluates to `false`) instead of a special case
it has to guard against.

_Attribute sourcing_ — how each bag actually gets populated from Identity
records, request claims, and resource lookups (this doc's resource-attribute
section above covers the last of those) — is `AttributeProvider`'s job,
Issue 145, not yet built.

## Evaluation semantics

`evaluateCondition` (`packages/authorization/domain/services/policy-evaluation-engine.ts`,
Issue 146) is a pure function: no I/O, no repository calls, walking a
`Condition` tree against an `AttributeContext` and returning a `boolean`.
Purity is what makes exhaustive branch-coverage testing of authorization
logic tractable — an evaluator that can also fail on a network call has a
failure mode no unit test can exercise deterministically.

- **Short-circuiting**: `AND` uses `Array.prototype.every`, `OR` uses
  `Array.prototype.some` — both bail out of the remaining operands as soon
  as the overall result is decided, so a comparison later in an `AND` never
  runs once an earlier one is `false` (verified directly in
  `policy-evaluation-engine.spec.ts` via a spy operand that must not be
  read).
- **Missing attributes evaluate to `false`**, never throw — a comparison
  against an attribute nobody supplied is the same "this rule doesn't
  apply" outcome as one that resolved and didn't match, not a distinct
  error condition the caller has to guard against.
- **Type mismatches evaluate to `false`**, not coerced — comparing a number
  operator (`lt`/`lte`/`gt`/`gte`) against a non-numeric, non-`Date`
  attribute, or `eq`/`neq` against mismatched array-vs-scalar shapes, never
  silently succeeds via implicit coercion. This is the same rationale
  Issue 147's operator library will formalize further; this evaluator
  anticipates it minimally so it's usable today.

`evaluateRule` evaluates a `Rule`'s condition alone — it does not consult
`rule.effect`. Turning "did this rule's condition match" into a
`PERMIT`/`DENY`/`NOT_APPLICABLE` outcome is the combining-algorithm layer's
job, covered next.

## Combining algorithms

A policy can have several rules, and a resource type can have several
applicable policies — `combining-algorithms.ts` (Issue 148) reduces all of
their outcomes to one final decision. `deriveRuleOutcomes` maps each rule to
`rule.effect` if its condition matched, `NOT_APPLICABLE` otherwise; a
`CombiningAlgorithm` then reduces the full outcome list:

| Algorithm                                                                        | Rule                                                       | When to use it                                                                                                        |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `denyOverrides` (**system default**, see `docs/security/authorization-model.md`) | any `DENY` wins over any `PERMIT`                          | Safety-favoring; one applicable deny should never be overridable by a more permissive rule elsewhere in the same set. |
| `permitOverrides`                                                                | any `PERMIT` wins over any `DENY`                          | Policy sets designed to be permissive-by-default.                                                                     |
| `firstApplicable`                                                                | the first non-`NOT_APPLICABLE` outcome wins, in rule order | Rule _order_ is meaningful and intentional — the other two algorithms are order-independent.                          |

All three return `NOT_APPLICABLE` when every input outcome is
`NOT_APPLICABLE` — "nothing had an opinion" is preserved rather than
defaulted to a `PERMIT` or `DENY` here; `AuthorizationService`
(`docs/security/authorization-model.md`) is where a fail-closed default is
actually applied, one layer up, once RBAC's opinion (or lack of one) is
also known.

These names are lifted directly from the XACML standard's
combining-algorithm vocabulary rather than invented — reusing established
names lets contributors bring prior ABAC knowledge to this code instead of
re-learning Verixa-specific terminology for a well-understood concept.
