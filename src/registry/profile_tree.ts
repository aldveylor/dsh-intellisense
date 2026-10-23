import { z } from 'zod';
import type { RegistryConfiguration } from './registry.js';

/** @brief Physical command identity used by editable Profile trees. */
export type CommandName = string;

/** @brief Original command summary, independent of its mounted path. */
export interface CommandBrief { name: CommandName; brief: string }

/** @brief A mounted physical command with an optional simplified description. */
export interface CommandNode { command: CommandName; simplifiedBrief?: string }

/** @brief Recursive namespace members keyed by their local names. */
export interface NamespaceNode { [name: string]: CommandNode | NamespaceNode }

/** @brief Public editable Profile representation. */
export interface Profile { name: string; root: NamespaceNode }

/** @brief Validate recursive Profile input before converting it into registry configuration. */
export const ProfileSchema: z.ZodType<Profile> = z.lazy(() => z.strictObject({ name: z.string(), root: namespaceSchema }));
const namespaceSchema: z.ZodType<NamespaceNode> = z.lazy(() => z.record(z.string(), z.union([z.strictObject({ command: z.string(), simplifiedBrief: z.string().optional() }), namespaceSchema])));

/** @brief Export only configured paths and comments; runtime metadata remains internal. */
export function profileTree(name: string, configuration: RegistryConfiguration): Profile {
    const root: NamespaceNode = Object.create(null);
    const nodeFor = (path: string): NamespaceNode => {
        let node = root;
        for (const part of path.split('.').filter(Boolean)) node = (node[part] ??= Object.create(null)) as NamespaceNode;
        return node;
    };
    for (const item of configuration.namespaces) nodeFor(item.path);
    for (const mapping of configuration.mappings) for (const path of [mapping.path, ...mapping.aliases]) {
        const parts = path.split('.');
        const brief = configuration.toolComments?.[mapping.id] ?? mapping.description;
        nodeFor(parts.slice(0, -1).join('.'))[parts.at(-1)!] = { command: mapping.id, ...(brief === undefined ? {} : { simplifiedBrief: brief }) };
    }
    return { name, root };
}

/** @brief Replace mounted paths while retaining pin preferences for surviving physical commands. */
export function profileConfiguration(profile: Profile, current: RegistryConfiguration, commands: readonly CommandBrief[]): RegistryConfiguration {
    const configuration: RegistryConfiguration = { ...current, mappings: [], namespaces: [], order: [], toolComments: {} };
    const visit = (node: NamespaceNode, prefix: string): void => {
        for (const [name, child] of Object.entries(node)) {
            const path = prefix ? `${prefix}.${name}` : name;
            configuration.order.push(path);
            if (typeof child.command === 'string') {
                const command = child as CommandNode;
                if (!commands.some(item => item.name === command.command)) throw new Error(`Unknown command: ${command.command}`);
                const previous = current.mappings.find(item => item.id === command.command);
                const mounted = configuration.mappings.find(item => item.id === command.command);
                if (mounted) mounted.aliases.push(path);
                else configuration.mappings.push({ id: command.command, path, aliases: [], enabled: true, pinned: false, alwaysVisible: previous?.alwaysVisible ?? current.unmountedVisible[command.command] ?? 0 });
                if (command.simplifiedBrief !== undefined) configuration.toolComments![command.command] = command.simplifiedBrief;
            } else {
                const previous = current.namespaces.find(item => item.path === path);
                configuration.namespaces.push(previous ?? { path, description: '', alwaysVisible: false });
                visit(child as NamespaceNode, path);
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
    command: CommandName;
    /** @brief Short description of what the command does. */
    simplifiedBrief?: string;
}
/** @brief Recursive namespace members keyed by local name. */
interface NamespaceNode { [name: string]: CommandNode | NamespaceNode; }
/** @brief Named command namespace configuration. */
interface Profile { name: string; root: NamespaceNode; }`;
