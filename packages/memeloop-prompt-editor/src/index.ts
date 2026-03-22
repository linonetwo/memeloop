/**
 * @memeloop/prompt-editor
 *
 * Platform-agnostic prompt config: schema generation, uiSchema building,
 * ConditionalField, ArrayItemContext. Web/native widgets: @memeloop/prompt-editor/web, @memeloop/prompt-editor/native.
 */

export const PROMPT_EDITOR_VERSION = "0.0.0";

export {
  getSchemaFromDefinition,
  buildUiSchema,
  shouldShowConditionalField,
  ArrayItemProvider,
  useArrayItemContext,
  ConditionalField,
} from "./core/index.js";
export type {
  DefinitionWithPromptSchema,
  SchemaWithUiSchema,
  ConditionalFieldConfig,
  ArrayItemContextValue,
  ArrayItemProviderProps,
  ExtendedFormContext,
} from "./core/index.js";
