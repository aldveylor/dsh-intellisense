import type { NamespaceDefinitions } from './definitions.js';
import { RootNamespace } from '../tools/profile_nodes/root_namespace.js';

/** @brief Builtin behavior is owned exclusively by the concrete Profile command implementations. */
export function registerBuiltinDefinitions(service: Pick<NamespaceDefinitions, 'createInitialProfile'>): void {
    service.createInitialProfile = () => new RootNamespace();
}
