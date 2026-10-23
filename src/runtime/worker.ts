import vm from 'node:vm';
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { isProxy } from 'node:util/types';
import { HostMessage, RpcId, WorkerMessage, RunResult, type ExecutionResult } from './protocol.js';

const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
const global = vm.runInContext('globalThis', context) as object;
const installedRoots = new Set<string>();
const standardGlobals = new Set([...Object.getOwnPropertyNames(global), ...Object.getOwnPropertyNames(globalThis)]);
const outstanding = new Map<number, { resolve(value: string): void; reject(error: Error): void }>();
let execution: string | undefined;
let sequence = 0;
let logs: string[] = [];
let bytes = 0;
let maxOutputBytes = 1_048_576;
let syncTimeoutMs = 1000;
let outputOverflow = false;
const output = new Writable({ write: (chunk: Buffer, _encoding, done) => {
    if (execution) {
        bytes += chunk.length;
        if (bytes <= maxOutputBytes) logs.push(chunk.toString().replace(/\r?\n$/, ''));
        else outputOverflow = true;
    }
    done();
} });
const console = new Console({ stdout: output, stderr: output, colorMode: false, inspectOptions: { customInspect: false, getters: false } });

/** @brief Validate every outgoing frame before it reaches the host. */
function send(message: unknown): void { process.send?.(WorkerMessage.parse(message)); }

/** @brief Install only VM-realm wrapper functions; the captured host callbacks are never visible as guest properties. */
function initialize(paths: string[], values: Record<string, unknown>): void {
    for (const root of installedRoots) delete context[root];
    installedRoots.clear();
    for (const path of [...paths, ...Object.keys(values)]) installedRoots.add(path.split('.')[0]!);
    const hostCall = (path: string, json: string): Promise<string> => {
        if (!execution) return Promise.reject(new Error('No active execution'));
        const id = RpcId.parse(++sequence);
        return new Promise((resolve, reject) => { outstanding.set(id, { resolve, reject }); send({ type: 'call', id, execution, path, args: JSON.parse(json) }); });
    };
    const hostPrint = (method: string, args: unknown[]): void => {
        if (!execution) return;
        const fn = console[method as keyof Console];
        if (typeof fn !== 'function') throw new Error('Unknown console method');
        Reflect.apply(fn, console, args);
    };
    const install = vm.runInContext(`(function(call, print, paths, methods, values) {
        "use strict";
        const parse=JSON.parse, stringify=JSON.stringify;
        if(!Object.hasOwn(globalThis,'ToolCallError')) {
            /** @brief A rejected namespace call, created entirely in the guest realm. */
            class ToolCallError extends Error {
                constructor(message,toolName){super(message);this.name='ToolCallError';this.toolName=toolName;}
            }
            Object.defineProperty(globalThis,'ToolCallError',{value:ToolCallError,configurable:false});
        }
        const tree=Object.create(null);
        const wrap=target=>(...args)=>new Promise((resolve,reject)=>{
                try { call(target,stringify(args.map(value=>[value!==undefined,value??null]))).then(json=>{try{const [present,value]=parse(json);resolve(present?value:undefined)}catch(error){reject(new Error(String(error))) }},error=>reject(new ToolCallError(String(error.message??error),target))); }
                catch(error){reject(new Error(String(error.message??error)))}
            });
        for(const path of parse(paths)) {
            const parts=path.split('.'); let node=tree;
            for(const part of parts.slice(0,-1)) node=node[part]??=(Object.create(null));
            const fn=wrap(path);
            Object.setPrototypeOf(fn,null); node[parts.at(-1)]=Object.freeze(fn);
        }
        for(const [path,value] of Object.entries(parse(values))) {
            const parts=path.split('.');let node=tree;
            for(const part of parts.slice(0,-1))node=node[part]??=Object.create(null);
            node[parts.at(-1)]=value;
        }
        const freeze=node=>{for(const child of Object.values(node))if(child&&typeof child==='object')freeze(child);Object.freeze(node)};
        freeze(tree);
        for(const [name,value] of Object.entries(tree))Object.defineProperty(globalThis,name,{value,configurable:true});
        const logger=Object.create(null);
        for(const method of parse(methods)) {
            const fn=(...args)=>{try{print(method,args)}catch(error){throw new Error(String(error.message??error))}};
            Object.setPrototypeOf(fn,null);logger[method]=Object.freeze(fn);
        }
        if(!Object.hasOwn(globalThis,'console')||Object.getOwnPropertyDescriptor(globalThis,'console').configurable)Object.defineProperty(globalThis,'console',{value:Object.freeze(logger),configurable:false});
    })`, context, { timeout: syncTimeoutMs }) as (call: typeof hostCall, print: typeof hostPrint, paths: string, methods: string, values: string) => void;
    install(hostCall, hostPrint, JSON.stringify(paths), JSON.stringify(Object.keys(console).filter(name => !name.startsWith('_'))), JSON.stringify(values));
}

/** @brief Traverse only own data descriptors; accessors and proxies never run during completion. */
function describe(path: string): string {
    let value: unknown = global;
    for (const part of path ? path.split('.') : []) {
        if (!/^[A-Za-z_$][\w$]*$/.test(part) || value === null || (typeof value !== 'object' && typeof value !== 'function') || isProxy(value)) return 'No additional information.';
        const descriptor = Object.getOwnPropertyDescriptor(value, part);
        if (!descriptor || !('value' in descriptor)) return 'No additional information.';
        value = descriptor.value;
    }
    if (value === null || (typeof value !== 'object' && typeof value !== 'function') || isProxy(value)) return `${path}: ${typeof value}`;
    return Object.getOwnPropertyNames(value).filter(name => !name.startsWith('__') && (path || !standardGlobals.has(name))).map(name => {
        const descriptor = Object.getOwnPropertyDescriptor(value, name)!;
        return `${path ? path + '.' : ''}${name}: ${'value' in descriptor ? typeof descriptor.value : 'accessor (not evaluated)'}`;
    }).join('\n');
}

process.on('message', async raw => {
    const parsed = HostMessage.safeParse(raw);
    if (!parsed.success) { process.exitCode = 1; process.disconnect(); return; }
    const message = parsed.data;
    if (message.type === 'reply') {
        const pending = outstanding.get(message.id); outstanding.delete(message.id);
        if (message.error !== undefined) pending?.reject(new Error(message.error));
        else pending?.resolve(JSON.stringify([message.value !== undefined, message.value ?? null]));
        return;
    }
    try {
        if (message.type === 'init') {
            if (execution) throw new Error('Cannot replace namespaces during an active execution');
            maxOutputBytes = message.maxOutputBytes; syncTimeoutMs = message.syncTimeoutMs;
            initialize(message.paths, message.values);
            send({ type: 'result', id: message.id, value: null });
        } else if (message.type === 'describe') {
            send({ type: 'result', id: message.id, value: describe(message.path).slice(0, maxOutputBytes) });
        } else {
            if (execution) throw new Error('Concurrent execution is not allowed');
            execution = message.execution; logs = []; bytes = 0; outputOverflow = false;
            let result: Omit<ExecutionResult, 'epoch'>;
            try {
                const value: unknown = await new vm.Script(message.javascript, { filename: 'exec.ts' }).runInContext(context, { timeout: syncTimeoutMs });
                if (outputOverflow) throw new Error('Execution output exceeds configured limit');
                const cloned = value === undefined ? undefined : RunResult.shape.value.parse(value);
                result = { logs, ...(cloned === undefined ? {} : { value: cloned }) };
                if (Buffer.byteLength(JSON.stringify(result)) > maxOutputBytes) throw new Error('Execution output exceeds configured limit');
            } catch (error) { result = { logs, error: error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error) }; }
            execution = undefined;
            for (const pending of outstanding.values()) pending.reject(new Error('Execution ended before the tool call settled'));
            outstanding.clear();
            send({ type: 'result', id: message.id, value: result });
        }
    } catch (error) { send({ type: 'result', id: message.id, error: error instanceof Error ? error.message : String(error) }); }
});
process.on('disconnect', () => process.exit(0));
