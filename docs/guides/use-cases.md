# Use Cases (Application Layer)

`RegisterUser` (`packages/identity/application/use-cases/register-user.ts`,
Issue 030) is the first concrete example of the **command-handler pattern**
every use case in Verixa follows: one class, one job, orchestrating domain
events, entities, and ports without containing business rules of its own.

## The shape

```ts
export interface RegisterUserCommand {
  readonly email: string;
  readonly displayName: string;
  readonly givenName?: string;
  readonly familyName?: string;
}

export type RegisterUserError = ValidationError | ConflictError;

export class RegisterUser {
  constructor(private readonly userRepository: UserRepository) {}

  async execute(command: RegisterUserCommand): Promise<Result<User, RegisterUserError>> {
    // 1. Parse/validate primitive input into value objects
    // 2. Check any cross-aggregate invariant the entity itself can't check alone
    //    (e.g. email uniqueness — a single User can't know about other Users)
    // 3. Construct/mutate the aggregate (which enforces its own invariants)
    // 4. Persist via the port
    // 5. Return the result
  }
}
```

Every use case:

- Is a class with **one public method**, conventionally named `execute`,
  taking a single **command** object (a plain data shape, `RegisterUserCommand`
  here) rather than positional parameters — adding a field later doesn't
  break every call site.
- Takes its dependencies (repositories, other ports) as **constructor
  parameters**, typed as the port interface, never a concrete adapter. This
  is what makes it testable without a database: pass an in-memory fake that
  satisfies the same interface (see `docs/guides/testing.md`).
- Returns `Result<T, E>` rather than throwing for expected failure modes
  (validation failure, a conflicting duplicate) — the same convention used
  throughout the domain layer, for the same reason: callers are forced to
  handle failure, and the type signature documents what can go wrong.

## Cyclic Verification Loops: RequestMoreInformation

`RequestMoreInformation` orchestrates the reviewer-initiated transition from
`in_review → needs_more_info` requiring an explicit, visible note. This supports
the non-linear KYC workflow where evidence is insufficient without forcing
a full new request, preserving prior evidence and history across re-submits.

Alternative rejected: forcing users to create a brand new verification request
from scratch when a minor document blur occurs. Rejected because it discards
audit history and creates unnecessary user friction.
