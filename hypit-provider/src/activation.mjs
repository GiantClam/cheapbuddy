import {
  createRuntimeEndpointAdapterFacet,
  runtimeConfigCredentialRef,
  runtimeConfigExact,
  runtimeConfigObject,
  runtimeConfigPositiveInteger,
  runtimeConfigString,
} from '@hypit/runtime-local/extension';
import { createCheapBuddyProvider, providerModule } from './provider.mjs';

export default {
  format: 'hypit.package@1',
  facets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context) {
      const config = runtimeConfigObject(context.config, 'CheapBuddy');
      runtimeConfigExact(config, ['baseUrl', 'apiKey', 'concurrency', 'pollIntervalMs'], 'CheapBuddy');
      const baseUrl = runtimeConfigString(config.baseUrl, 'CheapBuddy baseUrl');
      const apiKey = runtimeConfigCredentialRef(config.apiKey, 'CheapBuddy apiKey');
      if (!baseUrl || !apiKey || !context.pool) throw new Error('CheapBuddy requires baseUrl, apiKey and pool');
      return {
        endpoint: createCheapBuddyProvider({
          instance: context.instance,
          pool: context.pool,
          baseUrl,
          apiKey,
          defaultConcurrency: runtimeConfigPositiveInteger(config.concurrency, 'concurrency') ?? 2,
          pollIntervalMs: runtimeConfigPositiveInteger(config.pollIntervalMs, 'pollIntervalMs') ?? 5_000,
        }),
      };
    },
  })],
};
