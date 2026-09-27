export { Policy, type PolicyId, type PolicyTarget } from "./domain/entities/policy.js";
export {
  Condition,
  type AlwaysCondition,
  type AndCondition,
  type ComparisonCondition,
  type ComparisonLiteral,
  type ComparisonOperator,
  type NotCondition,
  type OrCondition,
} from "./domain/value-objects/condition.js";
export type { Effect } from "./domain/value-objects/effect.js";
export { Rule } from "./domain/value-objects/rule.js";
export type { PolicyRepository } from "./application/ports/policy-repository.js";
export { InMemoryPolicyRepository } from "./infrastructure/fakes/in-memory-policy-repository.js";
