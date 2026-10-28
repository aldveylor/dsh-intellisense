import { array, discriminatedUnion, json, literal, null as nullValue, number, record, strictObject, string, union, type infer as Infer } from 'zod';

/** @brief Branded execution and RPC identities admitted at each process boundary. */
export const ExecutionId = string().min(1).brand<'ExecutionId'>();
export const RpcId = number().int().positive().brand<'RpcId'>();

/** @brief Resolved command binding installed once in the guest realm. */
export const CommandBinding = strictObject({
    path: string().regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/),
    tool: string().min(1),
    parameters: discriminatedUnion('kind', [
        strictObject({ kind: literal('fields'), fields: array(string()) }),
        strictObject({ kind: literal('overloads'), layouts: array(array(string())) }),
        strictObject({ kind: literal('object') }),
    ]),
    result: discriminatedUnion('kind', [
        strictObject({ kind: literal('identity') }),
        strictObject({ kind: literal('discard') }),
        strictObject({ kind: literal('field'), field: string() }),
    ]),
});

/** @brief Serializable command contract shared by the namespace compiler and worker. */
export type CommandBinding = Infer<typeof CommandBinding>;

/** @brief Strict host-to-worker protocol; functions and host objects never cross IPC. */
export const HostMessage = discriminatedUnion('type', [
    strictObject({ type: literal('init'), id: RpcId, commands: array(CommandBinding), values: record(string(), json()).default({}), maxOutputBytes: number().int().positive(), syncTimeoutMs: number().int().positive() }),
    strictObject({ type: literal('execute'), id: RpcId, execution: ExecutionId, javascript: string() }),
    strictObject({ type: literal('describe'), id: RpcId, path: string() }),
    strictObject({ type: literal('reply'), id: RpcId, value: json().optional(), values: record(string(), json()).optional(), error: string().optional(), errorCode: string().optional() }),
]);

/** @brief Serializable execution outcome shared by worker, host and exec tool. */
export const RunResult = strictObject({ value: json().optional(), logs: array(string()), error: string().optional() });

/** @brief Strict worker-to-host protocol; invalid control messages close the process. */
export const WorkerMessage = discriminatedUnion('type', [
    strictObject({ type: literal('result'), id: RpcId, value: union([RunResult, string(), nullValue()]).optional(), error: string().optional() }),
    strictObject({ type: literal('call'), id: RpcId, execution: ExecutionId, tool: string().min(1), args: json() }),
]);

/** @brief Data shape returned to the model by the native exec tool. */
export type ExecutionResult = Infer<typeof RunResult> & { epoch: number };
