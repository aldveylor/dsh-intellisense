import { z } from 'zod';
import type { RegistryConfiguration } from './registry.js';

/** @brief Physical command identity used by editable Profile trees. */
export type CommandName = string;

/** @brief Original command summary, independent of its mounted path. */
export interface CommandBrief { name: CommandName; brief: string }

/** @brief A mounted physical command with an optional simplified description. */
export interface CommandNode { type: 'command'; command: CommandName; simplifiedBrief?: string; fixedLevel: 'none' | 'fixed-brief' | 'fixed-detail' }

/** @brief Recursive namespace members keyed by their local names. */
export interface NamespaceNode { type: 'namespace'; children: Record<string, CommandNode | NamespaceNode>; fixed: boolean }

/** @brief Public editable Profile representation. */
export interface Profile { name: string; root: NamespaceNode }

/** @brief Validate recursive Profile input before converting it into registry configuration. */
export const ProfileSchema: z.ZodType<Profile> = z.lazy(() => z.strictObject({ name: z.string(), root: namespaceSchema }));
const namespaceSchema: z.ZodType<NamespaceNode> = z.lazy(() => z.strictObject({
    type: z.literal('namespace'), fixed: z.boolean(),
    children: z.record(z.string(), z.union([z.strictObject({ type: z.literal('command'), command: z.string(), simplifiedBrief: z.string().optional(), fixedLevel: z.enum(['none', 'fixed-brief', 'fixed-detail']) }), namespaceSchema])),
}));

/** @brief Export only configured paths and comments; runtime metadata remains internal. */
export function profileTree(name: string, configuration: RegistryConfiguration): Profile {
    const root: NamespaceNode = { type: 'namespace', children: Object.create(null), fixed: false };
    const nodeFor = (path: string): NamespaceNode => {
        let node = root;
        for (const part of path.split('.').filter(Boolean)) {
            const child = node.children[part] ??= { type: 'namespace', children: Object.create(null), fixed: false };
            if (child.type !== 'namespace') throw new Error(`Namespace collides with command: ${path}`);
            node = child;
        }
        return node;
    };
    for (const item of configuration.namespaces) nodeFor(item.path).fixed = item.alwaysVisible;
    for (const mapping of configuration.mappings) for (const path of [mapping.path, ...mapping.aliases]) {
        const parts = path.split('.');
        const brief = configuration.toolComments?.[mapping.id] ?? mapping.description;
        nodeFor(parts.slice(0, -1).join('.')).children[parts.at(-1)!] = { type: 'command', command: mapping.id, fixedLevel: (['none', 'fixed-brief', 'fixed-detail'] as const)[mapping.alwaysVisible], ...(brief === undefined ? {} : { simplifiedBrief: brief }) };
    }
    return { name, root };
}

/** @brief Replace mounted paths and fixed visibility from the editable Profile tree. */
export function profileConfiguration(profile: Profile, current: RegistryConfiguration, commands: readonly CommandBrief[]): RegistryConfiguration {
    const configuration: RegistryConfiguration = { ...current, mappings: [], namespaces: [], order: [], toolComments: {} };
    const visit = (node: NamespaceNode, prefix: string): void => {
        for (const [name, child] of Object.entries(node.children)) {
            const path = prefix ? `${prefix}.${name}` : name;
            configuration.order.push(path);
            if (child.type === 'command') {
                const command = child;
                if (!commands.some(item => item.name === command.command)) throw new Error(`Unknown command: ${command.command}`);
                const mounted = configuration.mappings.find(item => item.id === command.command);
                if (mounted) mounted.aliases.push(path);
                else configuration.mappings.push({ id: command.command, path, aliases: [], enabled: true, pinned: false, alwaysVisible: command.fixedLevel === 'fixed-detail' ? 2 : command.fixedLevel === 'fixed-brief' ? 1 : 0 });
                if (command.simplifiedBrief !== undefined) configuration.toolComments![command.command] = command.simplifiedBrief;
            } else {
                const previous = current.namespaces.find(item => item.path === path);
                configuration.namespaces.push({ path, description: previous?.description ?? '', alwaysVisible: child.fixed });
                visit(child, path);
            }
        }
    };
    visit(profile.root, '');
    return configuration;
}

/** @brief English declaration text preloaded into the guest Profile namespace. */
export const profileAnnotation = `/** @brief Stable physical command name. */
type CommandName = string;
/** @brief Original command summary. */
interface CommandBrief { name: CommandName; brief: string; }
/** @brief A mounted command and its optional simplified description. */
interface CommandNode {
    type: 'command';
    command: CommandName;
    /** @brief Short description of what the command does. */
    simplifiedBrief?: string;
    /** @brief Prompt visibility: hidden, short summary, or complete contract. */
    fixedLevel: 'none' | 'fixed-brief' | 'fixed-detail';
}
/** @brief Recursive namespace members keyed by local name. */
interface NamespaceNode {
    type: 'namespace';
    children: Record<string, CommandNode | NamespaceNode>;
    /** @brief Include this namespace in the initial prompt. */
    fixed: boolean;
}
/** @brief Named command namespace configuration. */
interface Profile { name: string; root: NamespaceNode; }`;
