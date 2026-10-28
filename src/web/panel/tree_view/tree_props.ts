import type { DragEvent } from 'react';
import type { Namespace, Mapping, PhysicalTool, CommandVisibility } from '../../../registry/registry.js';

/** @brief Shared namespace tree data and actions for recursively rendered mixed node types. */
export interface TreeProps {
    disabledByAncestor: (path: string) => boolean; disabled: (path: string) => boolean; toggleDisabled: (path: string) => void;
    toolsById: ReadonlyMap<string, PhysicalTool>; callsByTool: Record<string, number>; queriesByTool: Record<string, number>; namespaceQueriesByPath: Record<string, number>; busy: boolean;
    expanded: Record<string, boolean>;
    configure: (path: string, patch: Partial<Namespace>) => void;
    drop: (event: DragEvent<HTMLElement>, parent: string) => void;
    pick: (parent: string) => void; create: (path: string) => boolean; rename: (path: string, name: string) => boolean;
    editDescription: (path: string) => void; remove: (path: string) => void; pinTool: (mapping: Mapping) => void;
    renameNamespace: (path: string, name: string) => boolean; deleteNamespace: (path: string) => void;
    toggle: (path: string) => void; dropNode: (event: DragEvent<HTMLElement>, path: string, namespace: boolean) => void;
    namespaceVisible: Record<string, boolean>; toggleProvidedNamespace: (path: string) => void;
    pinBuiltin: (path: string) => void; toolComments: Record<string, string>; unmountedVisible: CommandVisibility; pinUnmounted: (id: string) => void;
}

