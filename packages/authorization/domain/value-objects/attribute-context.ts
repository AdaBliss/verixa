/**
 * A value an attribute may hold. Dates get their own case (rather than
 * collapsing to a number/string timestamp) because time-window conditions
 * (`resource.availableFrom`, `env.now`) are a named use case in the DSL
 * design (Issue 142) and deserve a type that survives round-tripping through
 * this context, not a convention callers have to remember to parse.
 */
export type AttributeValue = string | number | boolean | Date | readonly (string | number)[];

/** One attribute bag: a flat, typed key/value map. */
export type AttributeBag = Readonly<Record<string, AttributeValue>>;

/** The four categories every policy condition may reference — see NIST SP 800-162. */
export type AttributeCategory = "subject" | "resource" | "action" | "environment";

function isAttributeCategory(value: string): value is AttributeCategory {
  return (
    value === "subject" || value === "resource" || value === "action" || value === "environment"
  );
}

/**
 * Everything a policy condition might condition on, bundled into the four
 * categories ABAC theory (and NIST SP 800-162) splits attributes into:
 * `subject` (the acting principal), `resource` (the target), `action` (the
 * operation being attempted), and `environment` (time, IP, request
 * metadata).
 *
 * Deliberately independent of *where* each bag's values came from — that is
 * an `AttributeProvider`'s job (Issue 145, not yet built), a different
 * concern this value object has no opinion about. `AttributeContext` is
 * just the shape the evaluation engine (Issue 146) evaluates a
 * {@link import("./condition.js").Condition} tree against, however it was
 * assembled — by a real provider pipeline once Issue 145 lands, or by hand
 * (as `AuthorizeAction`, Issue 153, currently does) until then.
 */
export class AttributeContext {
  private readonly bags: Readonly<Record<AttributeCategory, AttributeBag>>;

  private constructor(bags: Readonly<Record<AttributeCategory, AttributeBag>>) {
    this.bags = bags;
  }

  static create(bags: {
    subject?: AttributeBag;
    resource?: AttributeBag;
    action?: AttributeBag;
    environment?: AttributeBag;
  }): AttributeContext {
    return new AttributeContext({
      subject: bags.subject ?? {},
      resource: bags.resource ?? {},
      action: bags.action ?? {},
      environment: bags.environment ?? {},
    });
  }

  /**
   * Looks up `key` within `category`. Returns `undefined` for a missing
   * attribute rather than throwing — per Issue 144's acceptance criteria, a
   * policy referencing an attribute nobody supplied is an expected outcome
   * (the attribute genuinely doesn't apply to this request) the evaluation
   * engine has defined behavior for, not an error condition.
   */
  get(category: AttributeCategory, key: string): AttributeValue | undefined {
    return this.bags[category][key];
  }

  /**
   * Resolves a dotted path (`"resource.ownerId"`) against the four bags,
   * the addressing scheme {@link import("./condition.js").ComparisonCondition}
   * uses. Returns `undefined` for an unrecognized category or a missing key
   * within a recognized one — both are "no such attribute," and the caller
   * (the evaluation engine) treats them identically.
   */
  resolve(path: string): AttributeValue | undefined {
    const separatorIndex = path.indexOf(".");
    if (separatorIndex === -1) {
      return undefined;
    }

    const category = path.slice(0, separatorIndex);
    const key = path.slice(separatorIndex + 1);
    if (!isAttributeCategory(category)) {
      return undefined;
    }

    return this.get(category, key);
  }
}
