import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry';
import { apiGeneration } from '../../src/compatibility/version.js';
import { apply } from '../../src/preset/index.js';

test('preset version patches retain legacy discovery and omit removed host exports', async () => {
    const presets = new Map<string, PresetDefinition>();
    const releases: (() => void)[] = [];
    const ctx = {
        agentPresets: { register: async (preset: PresetDefinition) => {
            presets.set(preset.id, preset);
            return () => { presets.delete(preset.id); };
        } },
        effect: (setup: () => () => void) => { releases.push(setup()); },
    } as unknown as Context;
    await apply(ctx);
    assert.deepEqual([...presets.keys()], ['intellisense-ptc', 'intellisense']);
    const require = createRequire(import.meta.url);
    const host = createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
    for (const preset of presets.values()) {
        const delegation = preset.plugins.find(plugin => plugin.id === 'delegation');
        assert.equal(delegation?.group, true);
        const children = delegation?.config as PresetDefinition['plugins'];
        const discovery = children.filter(plugin => plugin.id === 'tool-subagent-list-agents');
        assert.equal(discovery.length, apiGeneration === 'legacy' ? 1 : 0);
        if (apiGeneration === 'legacy') {
            const control = children.findIndex(plugin => plugin.id === 'tool-subagent-control');
            assert.equal(children[control + 1], discovery[0]);
            assert.equal(discovery[0]?.name, '@deepseek-ai/dsh-tool-subagent-control/list-agents');
        }
        for (const plugin of children) assert.doesNotThrow(() => host.resolve(plugin.name));
        assert.deepEqual(preset.plugins.find(plugin => plugin.id === 'intellisense-presentation')?.config,
            { mode: preset.id === 'intellisense-ptc' ? 'ptc' : 'native' });
        assert.deepEqual(preset.plugins.find(plugin => plugin.id === 'tool-bash')?.disabled,
            { __jsExpr: "process.platform === 'win32'" });
    }
    for (const release of releases) release();
    assert.equal(presets.size, 0);
});
