export { AttributeContext } from "./domain/value-objects/attribute-context.js";
export type {
  AttributeBag,
  AttributeBagName,
  AttributeBags,
  AttributeRecord,
  AttributeValue,
  AttributeValueType,
} from "./domain/value-objects/attribute-context.js";
export { between, evaluateOperator } from "./domain/dsl/operators.js";
export type { ComparisonOperator, OperatorResult } from "./domain/dsl/operators.js";
export type {
  AttributeProvider,
  AttributeResolutionRequest,
} from "./application/ports/attribute-provider.js";
export {
  AttributeProviderResolutionError,
  AttributeResolutionPipeline,
} from "./application/services/attribute-resolution-pipeline.js";
export type {
  AttributeProviderFailure,
  AttributeResolutionResult,
} from "./application/services/attribute-resolution-pipeline.js";
