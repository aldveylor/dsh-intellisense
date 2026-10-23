import { LlmAdapter, LlmError, type GenerateOptions, type StreamChunk, type LlmRuntime, type LlmModelInfo, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';

/** @brief Public provider route that preserves upstream credentials and model capabilities. */
export class TextPtcRoute extends LlmAdapter {
    constructor(private llm: LlmRuntime) { super(); }

    override providerInfo(): { id: string; name: string } { return { id: 'intellisense-ptc', name: 'Intellisense PTC' }; }

    private target(model: string): { provider: string; model: string } {
        const slash = model.indexOf('/');
        if (slash < 1) throw new LlmError('Intellisense PTC model must identify its upstream provider and model', 'INVALID_MODEL');
        const provider = decodeURIComponent(model.slice(0, slash));
        if (provider === 'intellisense-ptc') throw new LlmError('Intellisense PTC cannot route to itself', 'INVALID_MODEL');
        return { provider, model: decodeURIComponent(model.slice(slash + 1)) };
    }

    override async listModels(): Promise<LlmModelInfo[]> {
        const models = await Promise.all(this.llm.listProviders().filter(provider => provider.id !== 'intellisense-ptc').map(provider => this.llm.listModels(provider.id)));
        return models.flat().map(model => ({ ...model, provider: 'intellisense-ptc', id: `${encodeURIComponent(model.provider)}/${encodeURIComponent(model.id)}` }));
    }

    override async resolveModel(_provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
        const target = this.target(model);
        return { ...await this.llm.resolveModelInfo(target.provider, target.model, signal), provider: 'intellisense-ptc', id: model };
    }

    override stream(options: GenerateOptions): AsyncIterable<StreamChunk> { return this.llm.stream({ ...options, ...this.target(options.model) }); }
}
