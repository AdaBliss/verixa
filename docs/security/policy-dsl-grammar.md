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
