/**
 * @memeloop/prompt-editor/web
 *
 * Web (MUI) widgets and templates. Based on @rjsf/mui.
 * Requires peer deps: @rjsf/mui, @mui/material, @emotion/react, @emotion/styled.
 */

export { default as Form, Theme } from "@rjsf/mui";

import { Theme } from "@rjsf/mui";

/** MUI-based widgets from @rjsf/mui theme */
export const widgets = Theme.widgets ?? {};

/** MUI-based templates from @rjsf/mui theme */
export const templates = Theme.templates ?? {};

export {
  getSchemaFromDefinition,
  buildUiSchema,
  shouldShowConditionalField,
  ArrayItemProvider,
  useArrayItemContext,
  ConditionalField,
} from "../core/index.js";
export type {
  DefinitionWithPromptSchema,
  SchemaWithUiSchema,
  ConditionalFieldConfig,
  ArrayItemContextValue,
  ArrayItemProviderProps,
  ExtendedFormContext,
} from "../core/index.js";
