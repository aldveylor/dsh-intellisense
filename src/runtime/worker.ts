import vm from 'node:vm';
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { isProxy } from 'node:util/types';
import { HostMessage, RpcId, WorkerMessage, RunResult, type ExecutionResult, type CommandBinding } from './protocol.js';

let context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
let global = vm.runInContext('globalThis', context) as object;
Object.defineProperty(global, 'globalThis', { value: undefined, writable: false, configurable: false });
const standardGlobals = new Set([...Object.getOwnPropertyNames(global), ...Object.getOwnPropertyNames(globalThis)]);
const outstanding = new Map<number, { promise: Promise<string>; resolve(value: string): void; reject(error: Error): void }>();
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
let console = new Console({ stdout: output, stderr: output, colorMode: false, inspectOptions: { customInspect: false, getters: false } });

/** @brief Validate every outgoing frame before it reaches the host. */
function send(message: unknown): void { process.send?.(WorkerMessage.parse(message)); }

/** @brief Install only VM-realm wrapper functions; the captured host callbacks are never visible as guest properties. */
function initialize(commands: CommandBinding[], values: Record<string, unknown>): void {
    context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    global = vm.runInContext('globalThis', context) as object;
    Object.defineProperty(global, 'globalThis', { value: undefined, writable: false, configurable: false });
    console = new Console({ stdout: output, stderr: output, colorMode: false, inspectOptions: { customInspect: false, getters: false } });
    const hostCall = (tool: string, json: string): Promise<string> => {
        if (!execution) return Promise.reject(new Error('No active execution'));
        const id = RpcId.parse(++sequence);
        let resolve!: (value: string) => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<string>((accept, fail) => { resolve = accept; reject = fail; });
        outstanding.set(id, { promise, resolve, reject });
        send({ type: 'call', id, execution, tool, args: JSON.parse(json) });
        return promise;
    };
    const hostPrint = (method: string, args: unknown[]): void => {
        if (!execution) return;
        const fn = console[method as keyof Console];
        if (typeof fn !== 'function') throw new Error('Unknown console method');
        Reflect.apply(fn, console, args);
    };
    const install = vm.runInContext(`(function(root, call, print, commands, methods, values) {
        "use strict";
        const parse=JSON.parse, stringify=JSON.stringify;
        if(!Object.hasOwn(root,'ToolCallError')) {
            /** @brief A rejected namespace call, created entirely in the guest realm. */
            class ToolCallError extends Error {
                constructor(message,toolName){super(message);this.name='ToolCallError';this.toolName=toolName;}
            }
            Object.defineProperty(root,'ToolCallError',{value:ToolCallError,configurable:false});
        }
        const logger=Object.create(null);
        for(const method of parse(methods)) {
            const fn=(...args)=>{try{print(method,args)}catch(error){throw new Error(String(error.message??error))}};
            Object.setPrototypeOf(fn,null);logger[method]=Object.freeze(fn);
        }
        if(!Object.hasOwn(root,'console')||Object.getOwnPropertyDescriptor(root,'console').configurable)Object.defineProperty(root,'console',{value:Object.freeze(logger),configurable:false});
        const tree=Object.create(null);
        const data=parse(values);
        const counters=new Map();
        for(const entry of Array.isArray(data['tools.profile.commands'])?data['tools.profile.commands']:[]) {
            if(!entry||typeof entry.name!=='string'||typeof entry.totalCalls!=='number')continue;
            let totalCalls=entry.totalCalls;
            counters.set(entry.name,()=>{totalCalls++;});
            Object.defineProperty(entry,'totalCalls',{get:()=>totalCalls,enumerable:true,configurable:false});
        }
        /** @brief A guest-owned command with its physical target and precompiled argument/result adapters. */
        class NamespaceCommand {
            constructor(binding) {
                this.path=binding.path;
                this.tool=binding.tool;
                this.count=counters.get(this.tool)??(()=>{});
                const parameters=binding.parameters;
                const named=(fields,args)=>Object.fromEntries(fields.flatMap((name,index)=>args[index]===undefined?[]:[[name,args[index]]]));
                switch(parameters.kind) {
                    case 'fields':
                        this.arguments=args=>{
                            if(args.length>parameters.fields.length)throw new Error('Too many arguments');
                            return named(parameters.fields,args);
                        };
                        break;
                    case 'rest': this.arguments=args=>({[parameters.field]:args}); break;
                    case 'overloads': {
                        const layouts=new Map(parameters.layouts.map(fields=>[fields.length,fields]));
                        this.arguments=args=>{
                            const fields=layouts.get(args.length);
                            if(!fields)throw new Error('Invalid positional argument count');
                            return named(fields,args);
                        };
                        break;
                    }
                    case 'object':
                        this.arguments=args=>{
                            if(args.length>1)throw new Error('Too many arguments');
                            const input=args[0]===undefined?{}:args[0];
                            if(!input||typeof input!=='object'||Array.isArray(input))return input;
                            const pairs=Object.entries(input).map(([key,value])=>[Object.hasOwn(parameters.aliases,key)?parameters.aliases[key]:key,value]);
                            const output=Object.fromEntries(pairs);
                            if(Object.keys(output).length!==pairs.length)throw new Error('Argument mapping contains a duplicate target');
                            return output;
                        };
                }
                const result=binding.result;
                this.result=result.kind==='discard'?()=>undefined
                    :result.kind==='field'?value=>value&&typeof value==='object'?(Object.hasOwn(value,result.field)?value[result.field]:undefined):value
                    :value=>value;
            }

            /** @brief Send the already resolved native tool and native argument object over IPC. */
            invoke(args) {
                return new Promise((resolve,reject)=>{
                    try {
                        const pending=call(this.tool,stringify(this.arguments(args)));
                        this.count();
                        pending.then(json=>{
                            try {const [present,value]=parse(json);resolve(this.result(present?value:undefined));}
                            catch(error){reject(new Error(String(error)));}
                        },error=>reject(new ToolCallError(String(error.message??error),this.path)));
                    } catch(error){reject(new Error(String(error)));}
                });
            }
        }
        for(const binding of parse(commands)) {
            const command=new NamespaceCommand(binding);
            const parts=command.path.split('.'); let node=tree;
            for(const part of parts.slice(0,-1)) node=node[part]??=Object.create(null);
            const fn=(...args)=>command.invoke(args);
            Object.setPrototypeOf(fn,null);
            if(Object.hasOwn(node,parts.at(-1)))throw new Error('Duplicate command deployment: '+command.path);
            node[parts.at(-1)]=Object.freeze(fn);
        }
        for(const [path,value] of Object.entries(data)) {
            const parts=path.split('.');let node=tree;
            for(const part of parts.slice(0,-1))node=node[part]??=Object.create(null);
            if(Object.hasOwn(node,parts.at(-1)))throw new Error('Conflicting value deployment: '+path);
            node[parts.at(-1)]=value;
        }
        const freeze=node=>{for(const child of Object.values(node))if(child&&typeof child==='object')freeze(child);Object.freeze(node)};
        freeze(tree);
        for(const [name,value] of Object.entries(tree))if(!Object.hasOwn(root,name))Object.defineProperty(root,name,{value,configurable:false});

    })`, context, { timeout: syncTimeoutMs }) as (root: object, call: typeof hostCall, print: typeof hostPrint, commands: string, methods: string, values: string) => void;
    install(global, hostCall, hostPrint, JSON.stringify(commands), JSON.stringify(Object.keys(console).filter(name => !name.startsWith('_'))), JSON.stringify(values));
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
            initialize(message.commands, message.values);
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
            while (outstanding.size) await Promise.allSettled([...outstanding.values()].map(pending => pending.promise));
            execution = undefined;
            send({ type: 'result', id: message.id, value: result });
        }
    } catch (error) { send({ type: 'result', id: message.id, error: error instanceof Error ? error.message : String(error) }); }
});
process.on('disconnect', () => process.exit(0));
