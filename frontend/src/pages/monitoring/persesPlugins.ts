// The Perses plugins the Monitoring page renders with, bundled into the console. Perses can also
// load plugins from its server at runtime (remotePluginLoader, module federation), but that loader
// doesn't work under Vite and runs CommonJS require(), so every plugin a dashboard may use is
// listed here. A panel whose plugin is missing shows Perses's own "plugin not found" error.
import { dynamicImportPluginLoader, getPluginModuleCompoundKey } from '@perses-dev/plugin-system';
import type { PluginModuleResource } from '@perses-dev/plugin-system';
import * as bar from '@perses-dev/bar-chart-plugin';
import * as prometheus from '@perses-dev/prometheus-plugin';
import * as stat from '@perses-dev/stat-chart-plugin';
import * as table from '@perses-dev/table-plugin';
import * as timeseries from '@perses-dev/timeseries-chart-plugin';

type PluginPackage = { getPluginModule: () => PluginModuleResource } & Record<string, unknown>;

/**
 * The registry finds a plugin by its compound key (kind, name, registry, version), so each module's
 * exports are also keyed that way, as odh-dashboard's persesPluginsLoader does.
 */
const bundled = (pkg: unknown) => {
  const mod = pkg as PluginPackage;
  const resource = mod.getPluginModule();
  return {
    resource,
    importPlugin: async () => {
      const out: Record<string, unknown> = { ...mod };
      for (const { kind, spec } of resource.spec.plugins) {
        const key = getPluginModuleCompoundKey({
          kind,
          name: spec.name,
          registry: resource.metadata.registry,
          version: resource.metadata.version,
        });
        out[key] = mod[spec.name];
      }
      return out;
    },
  };
};

export const pluginLoader = dynamicImportPluginLoader([
  bundled(prometheus),
  bundled(timeseries),
  bundled(stat),
  bundled(table),
  bundled(bar),
]);
