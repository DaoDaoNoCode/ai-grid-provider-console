// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/models/fields/RuntimeArgsField.tsx at 62319b8.
// Extracted from packages/model-serving/src/components/deploymentWizard/fields/RuntimeArgsField.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// The schema, helpers and hook, in their own module so the component file exports only the component.
import React from 'react';
import { z } from 'zod';

// Schema
export const runtimeArgsFieldSchema = z.object({
  enabled: z.boolean(),
  args: z.array(z.string()),
});

export type RuntimeArgsFieldData = z.infer<typeof runtimeArgsFieldSchema>;

export const isValidRuntimeArgs = (value: unknown): value is RuntimeArgsFieldData => {
  return runtimeArgsFieldSchema.safeParse(value).success;
};

/**
 * Drops blank lines and `#` comment headers before writing args onto a container, and trims the
 * rest: comment lines are useful in the wizard textarea but are not valid container argv, and
 * stray spaces would make an unchanged argument look edited.
 */
export const filterRuntimeArgsForContainer = (args: string[]): string[] =>
  args.map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'));

// Hook
export type RuntimeArgsFieldHook = {
  data: RuntimeArgsFieldData | undefined;
  setData: React.Dispatch<React.SetStateAction<RuntimeArgsFieldData | undefined>>;
};

export const useRuntimeArgsField = (existingData?: RuntimeArgsFieldData): RuntimeArgsFieldHook => {
  const [runtimeArgsData, setRuntimeArgsData] = React.useState<RuntimeArgsFieldData | undefined>(
    existingData || { enabled: false, args: [] },
  );

  return {
    data: runtimeArgsData,
    setData: setRuntimeArgsData,
  };
};
