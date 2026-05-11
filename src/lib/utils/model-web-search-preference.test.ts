import { describe, expect, it } from 'vitest';

import {
	getModelBuiltinWebSearchPreference,
	resolveModelBuiltinWebSearchState
} from './model-web-search-preference';

describe('model builtin web search preference', () => {
	it('reads explicit preferences from model meta and info meta', () => {
		expect(
			getModelBuiltinWebSearchPreference({
				meta: { builtin_tool_config: { ENABLE_WEB_SEARCH_TOOL: false } }
			})
		).toBe(false);
		expect(
			getModelBuiltinWebSearchPreference({
				info: { meta: { builtin_tool_config: { ENABLE_WEB_SEARCH_TOOL: true } } }
			})
		).toBe(true);
		expect(getModelBuiltinWebSearchPreference({ meta: {} })).toBe(null);
	});

	it('lets a single model explicitly disable web search', () => {
		expect(
			resolveModelBuiltinWebSearchState(
				[{ meta: { builtin_tool_config: { ENABLE_WEB_SEARCH_TOOL: false } } }],
				'native',
				() => 'native'
			)
		).toEqual({ mode: 'off', source: 'model' });
	});

	it('lets any selected model explicitly disable web search', () => {
		expect(
			resolveModelBuiltinWebSearchState(
				[
					{ meta: { builtin_tool_config: { ENABLE_WEB_SEARCH_TOOL: true } } },
					{ info: { meta: { builtin_tool_config: { ENABLE_WEB_SEARCH_TOOL: false } } } }
				],
				'halo',
				() => 'auto'
			)
		).toEqual({ mode: 'off', source: 'model' });
	});

	it('uses the enabled mode picker when a model explicitly enables web search', () => {
		expect(
			resolveModelBuiltinWebSearchState(
				[{ info: { meta: { builtin_tool_config: { ENABLE_WEB_SEARCH_TOOL: true } } } }],
				'off',
				() => 'auto'
			)
		).toEqual({ mode: 'auto', source: 'model' });
	});
});
