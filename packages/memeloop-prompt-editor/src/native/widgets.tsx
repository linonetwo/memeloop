/**
 * React Native Paper-based widgets for RJSF.
 * Optional peer: react-native-paper. When present, these widgets are used.
 */

import type { WidgetProps } from "@rjsf/utils";
import React from "react";

type PaperModule = {
  TextInput?: React.ComponentType<{
    mode?: string;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    onChangeText?: (text: string) => void;
    onBlur?: () => void;
    style?: unknown;
  }>;
  Checkbox?: { Item: React.ComponentType<{ label: string; status: string; onPress: () => void; disabled?: boolean }> };
};

function getPaper(): PaperModule | null {
  try {
    return require("react-native-paper") as PaperModule;
  } catch {
    return null;
  }
}

/** Text input widget using React Native Paper TextInput */
export function TextWidget(props: WidgetProps): React.ReactElement {
  const { id, value, readonly, disabled, placeholder, onChange, onBlur } = props;
  const Paper = getPaper();
  if (!Paper?.TextInput) {
    return <React.Fragment />;
  }
  return (
    <Paper.TextInput
      mode="outlined"
      value={(value as string) ?? ""}
      placeholder={placeholder}
      disabled={disabled ?? readonly}
      onChangeText={(text: string) => onChange(text === "" ? undefined : text)}
      onBlur={() => onBlur(id, (value as string) ?? "")}
      style={{ marginBottom: 8 }}
    />
  );
}

/** Checkbox widget using React Native Paper Checkbox */
export function CheckboxWidget(props: WidgetProps): React.ReactElement {
  const { value, disabled, onChange } = props;
  const Paper = getPaper();
  if (!Paper?.Checkbox) {
    return <React.Fragment />;
  }
  return (
    <Paper.Checkbox.Item
      label=""
      status={value ? "checked" : "unchecked"}
      onPress={() => onChange(!value)}
      disabled={disabled}
    />
  );
}

/** Widgets map for use with RJSF Form */
export function getNativeWidgets(): Record<string, React.ComponentType<WidgetProps>> {
  return {
    TextWidget,
    CheckboxWidget,
    textarea: TextWidget,
  };
}
