import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import type { ConversationNodeDefinition, ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client';
import type { TrajectorySnapshot } from '@deepseek-ai/dsh-client-ui-trajectory/client';
import { replTrajectory } from '../../src/web/execution_trace/trajectory.js';

/** @brief Load the shipped browser assembler and trajectory definitions with inert UI dependencies. */
function nativeTrajectory() {
    const require = createRequire(import.meta.url);
    const dom = new JSDOM('', { url: 'http://localhost/' });
    const cache = new Map<string, unknown>();
    /** @brief Evaluate native lazy modules without mounting React components. */
    function load(name: string, resolver = require): any {
        if (name === '@deepseek-ai/dsh-client-store') return {
            createSnapshotStore: (value: unknown) => ({ getSnapshot: () => value, subscribe: () => () => {} }),
        };
        if (['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots', '@tanstack/react-virtual'].includes(name)) {
            return new Proxy({}, { get: () => () => null });
        }
        if (cache.has(name)) return cache.get(name);
        if (!name.startsWith('@deepseek-ai/dsh-client-')) return resolver(name);
        const path = resolver.resolve(`${name}/client`);
        let factory!: (require: (id: string) => unknown) => unknown;
        runInNewContext(readFileSync(path, 'utf8'), {
            window: { __ModuleLoader__: { load: (entry: { factory: typeof factory }) => { factory = entry.factory; } } },
            document: dom.window.document, navigator: dom.window.navigator, Element: dom.window.Element,
            HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage,
            setTimeout, clearTimeout, queueMicrotask, URL, AbortController, TextEncoder, TextDecoder,
        });
        const module = factory(id => load(id, createRequire(path)));
        cache.set(name, module);
        return module;
    }
    const conversation = load('@deepseek-ai/dsh-client-ui-conversation') as typeof import('@deepseek-ai/dsh-client-ui-conversation/client');
    const trajectory = load('@deepseek-ai/dsh-client-ui-trajectory') as typeof import('@deepseek-ai/dsh-client-ui-trajectory/client');
    const definitions: ConversationNodeDefinition[] = [];
    const views: ConversationViewDefinition[] = [];
    trajectory.apply({
        effect: () => {}, locale: { bind: () => () => '' }, uiSession: { provide: () => {} }, slots: { inject: () => {} },
        uiConversation: {
            events: { register: (definition: ConversationNodeDefinition) => definitions.push(definition) },
            views: { register: (view: ConversationViewDefinition) => views.push(view) },
            inspectRequestPrompt: conversation.inspectRequestPrompt,
        },
    } as any);
    const match = replTrajectory.match as Readonly<Record<string, ConversationNodeDefinition['match']>>;
    definitions.push({ ...replTrajectory, match: event => match[event.type]?.(event) ?? null });
    return {
        close: () => dom.window.close(),
        create: () => new conversation.ConversationNodeAssembler({ entries: () => definitions, fallbackEntry: () => undefined }, { entries: () => views }),
    };
}

test('REPL execution stays visible during reasoning and live settlement matches durable replay with child schemas', () => {
    const native = nativeTrajectory();
    try {
        const assembler = native.create();
        assembler.activateTarget('trajectory');
        const durable: SessionEventLikeEntry[] = [];
        let sequence = 0;
        /** @brief Admit durable events exactly as the connected session feed does. */
        const append = (type: string, data: unknown) => {
            const entry = { type: 'event', event: { type, data, seq: ++sequence, time: sequence * 100 } } as SessionEventLikeEntry;
            durable.push(entry); assembler.append(entry); assembler.flush();
            return entry;
        };
        /** @brief Read the native snapshot after every feed publication. */
        const snapshot = () => assembler.snapshot('trajectory') as TrajectorySnapshot;
        append('turn/start', { turn: 1 });
        append('step/start', { turn: 1, step: 1 });
        const schema = { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } };
        append('request/header', { reason: 'initial', header: { config: { provider: 'ts-repl', model: 'test' }, tools: [schema] } });
        assembler.append({ type: 'transient', event: {
            type: 'assistant/live-chunk', seq: sequence + 0.1, time: 350,
            data: { attemptId: 'attempt-1', turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Considering the file' } },
        } } as SessionEventLikeEntry);
        assembler.flush();
        assert.equal(snapshot().partial?.blocks[0]?.kind, 'reasoning');
        const sourceStart = append('ts-repl/source', { turn: 1, step: 1, callId: 'ts-repl-1', offset: 0, text: 'await unknown.re' });
        let previewNode = snapshot().eventNodes.find(node => node.kind === 'assistant');
        assert(previewNode?.kind === 'assistant' && previewNode.blocks[0]?.kind === 'tool-call');
        assert.equal(JSON.parse(previewNode.blocks[0].argsRaw).code, 'await unknown.re');
        assert.equal(snapshot().partial?.blocks[0]?.kind, 'reasoning');
        append('ts-repl/source', { turn: 1, step: 1, callId: 'ts-repl-1', offset: 16, text: 'ad({path: "a"})' });
        previewNode = snapshot().eventNodes.find(node => node.kind === 'assistant');
        assert(previewNode?.kind === 'assistant' && previewNode.blocks[0]?.kind === 'tool-call');
        assert.equal(JSON.parse(previewNode.blocks[0].argsRaw).code, 'await unknown.read({path: "a"})');
        const execution = append('assistant/message', { turn: 1, step: 1, stream: [], message: {
            id: 'execution-1', role: 'assistant', source: { provider: 'mock', model: 'test' },
            content: [{ type: 'tool-call', id: 'ts-repl-1', name: 'ts_repl', arguments: '{"code":"await unknown.read({path: \'a\'})"}' }],
        } });
        assert.equal(snapshot().partial?.blocks[0]?.kind, 'reasoning', 'execution must not settle live reasoning');
        assert.equal(snapshot().eventNodes.filter(node => node.kind === 'assistant').length, 1, 'execution must be visible immediately');
        append('tool/call', { turn: 1, step: 1, callId: 'ts-repl-1', name: 'ts_repl', arguments: '{}' });
        const dispatch = { rootCallId: 'ts-repl-1', parentCallId: 'ts-repl-1', subCallId: 'child-1', name: 'read', arguments: { path: 'a' } };
        append('tool/ptc-dispatch-start', dispatch);
        assert.equal(snapshot().runningCalls[0]?.subCalls.length, 1);
        assert.equal(snapshot().callSchemas.get('child-1')?.name, 'read', 'schema must exist while the child runs');
        append('tool/ptc-dispatch', { ...dispatch, content: [{ type: 'text', text: 'contents' }], isError: false });
        append('tool/result', { turn: 1, step: 1, message: { role: 'tool', source: { callId: 'ts-repl-1' }, content: [{ type: 'text', text: 'contents' }] } });
        const final = append('assistant/message', { turn: 1, step: 1, stream: [], message: {
            id: 'final-1', role: 'assistant', source: { provider: 'mock', model: 'test' },
            content: [{ type: 'reasoning', text: 'Considering the file' }, { type: 'text', text: 'contents' }],
        } });
        assembler.settleAssistant('attempt-1' as any, final as any); assembler.flush();
        append('step/end', { turn: 1, step: 1 });
        append('turn/end', { turn: 1, reason: { kind: 'completed' } });
        const live = snapshot();
        assert.equal(live.partial, null);
        const assistants = live.eventNodes.filter(node => node.kind === 'assistant');
        assert.equal(assistants.length, 2);
        assert.equal(assistants[0]?.seq, sourceStart.event.seq);
        assert(sourceStart.event.seq < execution.event.seq);
        assert.equal(assistants[1]?.blocks[0]?.kind, 'reasoning');
        assert.deepEqual(JSON.parse(JSON.stringify(live.callSchemas.get('child-1')?.parameters)), schema.parameters);
        const replay = native.create();
        replay.replaceWindow(durable, false); replay.activateTarget('trajectory');
        assert.deepEqual(JSON.parse(JSON.stringify(replay.snapshot('trajectory'))), JSON.parse(JSON.stringify(live)));
        assert.equal((replay.snapshot('trajectory') as TrajectorySnapshot).callSchemas.get('child-1')?.name, 'read');
    } finally { native.close(); }
});

test('interrupted code generation replays as interrupted source without a running physical call', () => {
    const native = nativeTrajectory();
    try {
        const entries = [
            { type: 'turn/start', data: { turn: 1 } },
            { type: 'step/start', data: { turn: 1, step: 1 } },
            { type: 'ts-repl/source', data: { turn: 1, step: 1, callId: 'ts-repl-cancelled', offset: 0, text: 'await unknown.' } },
            { type: 'ts-repl/source', data: { turn: 1, step: 1, callId: 'ts-repl-cancelled', offset: 14, text: '', interrupted: true } },
            { type: 'step/end', data: { turn: 1, step: 1 } },
            { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
        ].map((event, index) => ({ type: 'event', event: { ...event, seq: index + 1, time: index * 100 } })) as SessionEventLikeEntry[];
        const assembler = native.create();
        assembler.replaceWindow(entries, false); assembler.activateTarget('trajectory');
        const snapshot = assembler.snapshot('trajectory') as TrajectorySnapshot;
        const source = snapshot.eventNodes.find(node => node.kind === 'assistant');
        assert(source?.kind === 'assistant');
        assert.equal(source.interrupted, true);
        assert.equal(snapshot.runningCalls.length, 0);
        assert(!snapshot.eventNodes.some(node => node.kind === 'tool-result'));
    } finally { native.close(); }
});
