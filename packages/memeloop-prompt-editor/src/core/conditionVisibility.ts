/**
 * Conditional field visibility logic.
 * Platform-agnostic: pure function used by ConditionalField component.
 */

/**
 * Configuration for conditional field display.
 * Used with ConditionalField to show/hide fields based on sibling field values.
 */
export interface ConditionalFieldConfig {
  dependsOn: string;
  showWhen: string | string[];
  hideWhen?: boolean;
}

/**
 * Resolves a field path (e.g. "root_prompts_0_children_1") to the parent object in rootFormData.
 * Returns the parent object and the dependent field value, or undefined if path is invalid.
 */
function getParentAndDependentValue(
  rootFormData: Record<string, unknown>,
  fieldPath: string,
  dependsOn: string,
): unknown {
  const pathParts = fieldPath.replace(/^root_/, "").split("_").filter(Boolean);
  pathParts.pop(); // current field name -> parent path

  let parent: unknown = rootFormData;
  for (const part of pathParts) {
    if (parent != null && typeof parent === "object" && part in (parent as Record<string, unknown>)) {
      parent = (parent as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  const parentObj = parent as Record<string, unknown> | undefined;
  return parentObj?.[dependsOn];
}

/**
 * Computes whether a conditional field should be visible.
 *
 * @param condition - ui:condition from uiSchema
 * @param rootFormData - full form data (from formContext)
 * @param fieldPathId - RJSF field path (e.g. from fieldPathId.$id)
 * @returns true if the field should be shown
 */
export function shouldShowConditionalField(
  condition: ConditionalFieldConfig | undefined,
  rootFormData: Record<string, unknown> | undefined,
  fieldPathId: string | undefined,
): boolean {
  if (!condition) return true;
  if (!rootFormData) return true;

  const { dependsOn, showWhen, hideWhen = false } = condition;
  const fieldPath = typeof fieldPathId === "string" ? fieldPathId : "";

  const dependentValue = getParentAndDependentValue(rootFormData, fieldPath, dependsOn);
  let conditionMet: boolean;

  if (Array.isArray(showWhen)) {
    conditionMet = showWhen.includes(String(dependentValue));
  } else {
    conditionMet = dependentValue === showWhen;
  }

  return hideWhen ? !conditionMet : conditionMet;
}
