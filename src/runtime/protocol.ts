import { z } from 'zod';

/** @brief Branded execution and RPC identities admitted at each process boundary. */
export const ExecutionId = z.string().min(1).brand<'ExecutionId'>();
export const RpcId = z.number().int().positive().brand<'RpcId'>();

/** @brief Resolved command binding installed once in the guest realm. */
export const CommandBinding = z.strictObject({
    path: z.string().regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/),
    tool: z.string().min(1),
    parameters: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('fields'), fields: z.array(z.string()) }),
        z.strictObject({ kind: z.literal('rest'), field: z.string() }),
        z.strictObject({ kind: z.literal('overloads'), layouts: z.array(z.array(z.string())) }),
        z.strictObject({ kind: z.literal('object'), aliases: z.record(z.string(), z.string()) }),
    ]),
    result: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('identity') }),
        z.strictObject({ kind: z.literal('discard') }),
        z.strictObject({ kind: z.literal('field'), field: z.string() }),
    ]),
});

/** @brief Serializable command contract shared by the namespace compiler and worker. */
export type CommandBinding = z.infer<typeof CommandBinding>;

/** @brief Strict host-to-worker protocol; functions and host objects never cross IPC. */
export const HostMessage = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('init'), id: RpcId, commands: z.array(CommandBinding), values: z.record(z.string(), z.json()).default({}), maxOutputBytes: z.number().int().positive(), syncTimeoutMs: z.number().int().positive() }),
    z.strictObject({ type: z.literal('execute'), id: RpcId, execution: ExecutionId, javascript: z.string() }),
    z.strictObject({ type: z.literal('describe'), id: RpcId, path: z.string() }),
    z.strictObject({ type: z.literal('reply'), id: RpcId, value: z.json().optional(), error: z.string().optional() }),
]);

/** @brief Serializable execution outcome shared by worker, host and exec tool. */
export const RunResult = z.strictObject({ value: z.json().optional(), logs: z.array(z.string()), error: z.string().optional() });

/** @brief Strict worker-to-host protocol; invalid control messages close the process. */
export const WorkerMessage = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('result'), id: RpcId, value: z.union([RunResult, z.string(), z.null()]).optional(), error: z.string().optional() }),
    z.strictObject({ type: z.literal('call'), id: RpcId, execution: ExecutionId, tool: z.string().min(1), args: z.json() }),
]);

/** @brief Data shape returned to the model by the native exec tool. */
export type ExecutionResult = z.infer<typeof RunResult> & { epoch: number };
