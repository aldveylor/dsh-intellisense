import { SessionRuntime, type Environment, type SessionCheckpoint } from './session.js';
import { complete } from '../typescript/completion.js';
import type { Usage } from '../registry/registry.js';

/** @brief Typed process messages carry data, never host runtime objects or credentials. */
interface Request { id: number; method: 'update' | 'validate' | 'execute' | 'complete' | 'declarations' | 'checkpoint' | 'restore'; args: unknown[] }
const outstanding = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let nextCall = 0;
let environment: Environment = { declarations: '', paths: [] };
/** @brief Ask the parent for an independently authorized capability invocation. */
function bridge(kind: 'invoke' | 'sort', path: string, args: unknown): Promise<unknown> {
    const id = ++nextCall;
    return new Promise((resolve, reject) => {
        outstanding.set(id, { resolve, reject });
        process.send?.({ type: kind, id, path, args });
    });
}
const runtime = new SessionRuntime((path, args) => bridge('invoke', path, args), () => bridge('sort', '', null));
let queue: Promise<unknown> = Promise.resolve();
process.on('message', (message: Request | { type: 'bridge-result'; id: number; value?: unknown; error?: string }) => {
    if ('type' in message) {
        const pending = outstanding.get(message.id);
        outstanding.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error)); else pending?.resolve(message.value);
        return;
    }
    queue = queue.then(async () => {
        try {
            let value: unknown;
            switch (message.method) {
                case 'update': environment = message.args[0] as Environment; runtime.update(environment); value = null; break;
                case 'validate': value = runtime.validate(message.args[0] as string); break;
                case 'execute': value = await runtime.execute(message.args[0] as string, message.args[1] as string); break;
                case 'complete': value = complete(runtime, environment, message.args[0] as string, message.args[1] as Record<string, Usage>, message.args[2] as Record<string, string>); break;
                case 'declarations': value = runtime.declarations(); break;
                case 'checkpoint': value = runtime.checkpoint(); break;
                case 'restore': runtime.restore(message.args[0] as SessionCheckpoint); value = null; break;
            }
            process.send?.({ type: 'result', id: message.id, value });
        } catch (error) { process.send?.({ type: 'result', id: message.id, error: error instanceof Error ? error.message : String(error) }); }
    });
});
process.on('disconnect', () => process.exit(0));
