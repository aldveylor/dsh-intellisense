import type { Context } from '@deepseek-ai/cordis';
import { version } from '../compatibility/version.js';
import type { NamespaceIntegration } from './namespace_integration.js';

/** @brief Await scoped initialization before DSH captures tool admission or preview declarations. */
export function registerSessionInitialization(ctx: Context, namespaces: NamespaceIntegration): void {
    const tools = ctx.tools;
    const prompt = ctx.systemPrompt;
    ctx.effect(() => {
        const resolveDescriptor = Object.getOwnPropertyDescriptor(tools, 'resolve');
        const assembleDescriptor = Object.getOwnPropertyDescriptor(prompt, 'assemble');
        const resolve = tools.resolve;
        const assemble = prompt.assemble;
        // DSH 0.2.2 has no awaited preset-rebind or pre-resolution event.
        version.gte('0.2.2-alpha.2', () => Object.defineProperty(tools, 'resolve', { configurable: true, writable: true,
            value: async function (this: typeof tools, context: Parameters<typeof resolve>[0]) {
                context.signal.throwIfAborted();
                await namespaces.configure(context.agent);
                context.signal.throwIfAborted();
                return resolve.call(this, context);
            },
        }));
        Object.defineProperty(prompt, 'assemble', { configurable: true, writable: true,
            value: async function (this: typeof prompt, context: Parameters<typeof assemble>[0] = {}) {
                if (context.agent && !context.toolSet) await namespaces.configure(context.agent);
                return assemble.call(this, context);
            },
        });
        return () => {
            if (resolveDescriptor) Object.defineProperty(tools, 'resolve', resolveDescriptor);
            else Reflect.deleteProperty(tools, 'resolve');
            if (assembleDescriptor) Object.defineProperty(prompt, 'assemble', assembleDescriptor);
            else Reflect.deleteProperty(prompt, 'assemble');
        };
    });
}
