/**
 * React Native Paper-based templates for RJSF.
 */

import type {
  FieldTemplateProps,
  ObjectFieldTemplateProps,
  TemplatesType,
  ArrayFieldTemplateProps,
  ErrorListProps,
} from "@rjsf/utils";
import React from "react";

function getRn(): {
  View: React.ComponentType<{ style?: unknown; children?: React.ReactNode }>;
  Text: React.ComponentType<{ style?: unknown; children?: React.ReactNode }>;
} | null {
  try {
    // 可选 peer：RN 宿主才安装 react-native
    return require("react-native") as ReturnType<typeof getRn>;
  } catch {
    return null;
  }
}

function FieldTemplate(props: FieldTemplateProps): React.ReactElement {
  const RN = getRn();
  if (!RN?.View || !RN?.Text) {
    return <React.Fragment>{props.children}</React.Fragment>;
  }
  return (
    <RN.View style={{ marginBottom: 12 }}>
      {props.label}
      {props.description}
      {props.children}
      {props.errors}
      {props.help}
    </RN.View>
  );
}

function ObjectFieldTemplate(props: ObjectFieldTemplateProps): React.ReactElement {
  const RN = getRn();
  if (!RN?.View) {
    return <React.Fragment>{props.properties.map((p) => p.content)}</React.Fragment>;
  }
  return <RN.View style={{ gap: 8 }}>{props.properties.map((p) => p.content)}</RN.View>;
}

function ArrayFieldTemplate(props: ArrayFieldTemplateProps): React.ReactElement {
  const RN = getRn();
  if (!RN?.View) {
    return <React.Fragment>{props.items.map((i) => i.children)}</React.Fragment>;
  }
  return (
    <RN.View style={{ gap: 8 }}>
      {props.title}
      {props.items.map((item) => (
        <RN.View key={item.key}>{item.children}</RN.View>
      ))}
    </RN.View>
  );
}

function ErrorListTemplate(props: ErrorListProps): React.ReactElement | null {
  const RN = getRn();
  const errs = props.errors ?? [];
  if (errs.length === 0) return null;
  if (!RN?.View || !RN?.Text) return null;
  return (
    <RN.View style={{ marginVertical: 8 }}>
      {errs.map((e, i) => (
        <RN.Text key={i} style={{ color: "#b00020" }}>
          {typeof e === "string" ? e : (e as { message?: string }).message ?? String(e)}
        </RN.Text>
      ))}
    </RN.View>
  );
}

export const templates: Partial<TemplatesType> = {
  FieldTemplate,
  ObjectFieldTemplate,
  ArrayFieldTemplate,
  ErrorListTemplate,
};
