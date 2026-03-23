<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { getContext, onDestroy, tick } from 'svelte';

	import { chatCompletion } from '$lib/apis/openai';
	import { createOpenAITextStream } from '$lib/apis/streaming';
	import ChatBubble from '$lib/components/icons/ChatBubble.svelte';
	import LightBlub from '$lib/components/icons/LightBlub.svelte';
	import { settings } from '$lib/stores';
	import Markdown from '../Messages/Markdown.svelte';
	import Skeleton from '../Messages/Skeleton.svelte';

	const i18n = getContext('i18n');

	type FloatingAction = {
		id: string;
		label: string;
		icon?: any;
		input?: boolean;
		prompt: string;
	};

	type FloatingChatRequestFactory = ((args: {
		modelId: string;
		messages: any[];
		stream?: boolean;
	}) => Promise<Record<string, unknown>>) | undefined;

	export let id = '';
	export let model = null;
	export let messages = [];
	export let actions: FloatingAction[] = [];
	export let onAdd = () => {};

	const floatingChatRequestFactory =
		getContext<FloatingChatRequestFactory>('floatingChatRequestFactory');

	const defaultActions: FloatingAction[] = [
		{
			id: 'ask',
			label: $i18n.t('Ask'),
			icon: ChatBubble,
			input: true,
			prompt: '{{SELECTED_CONTENT}}\n\n\n{{INPUT_CONTENT}}'
		},
		{
			id: 'explain',
			label: $i18n.t('Explain'),
			icon: LightBlub,
			input: false,
			prompt: `{{SELECTED_CONTENT}}\n\n\n${$i18n.t('Explain')}`
		}
	];
	$: resolvedActions = (actions ?? []).length > 0 ? actions : defaultActions;

	let floatingInput = false;
	let selectedAction: FloatingAction | null = null;

	let selectedText = '';
	let selectedTextForDisplay = '';
	let userInputForDisplay = '';
	let floatingInputValue = '';

	let prompt = '';
	let responseContent: string | null = null;
	let responseDone = false;
	let requestController: AbortController | null = null;
	let responseUsage: Record<string, unknown> | null = null;

	// Expose to parent for dismissal prevention
	export let hasActiveResponse = false;
	$: hasActiveResponse = responseContent !== null;

	const autoScroll = async () => {
		const responseContainer = document.getElementById('response-container');
		if (!responseContainer) {
			return;
		}

		if (
			responseContainer.scrollHeight - responseContainer.clientHeight <=
			responseContainer.scrollTop + 50
		) {
			responseContainer.scrollTop = responseContainer.scrollHeight;
		}
	};

	const buildPrompt = (action: FloatingAction, inputContent = '') => {
		const selectedQuotedText = selectedText
			.split('\n')
			.map((line) => `> ${line}`)
			.join('\n');

		return (action.prompt ?? '')
			.replaceAll('{{INPUT_CONTENT}}', inputContent)
			.replaceAll('{{CONTENT}}', selectedText)
			.replaceAll('{{SELECTED_CONTENT}}', selectedQuotedText);
	};

	const applySelectionHighlight = () => {
		try {
			const selection = window.getSelection();
			if (selection && selection.rangeCount > 0 && 'highlights' in CSS) {
				const range = selection.getRangeAt(0).cloneRange();
				const highlight = new (window as any).Highlight(range);
				(CSS as any).highlights.set('float-selection', highlight);
			}
		} catch (e) {
			// Graceful degradation
		}
	};

	const clearSelectionHighlight = () => {
		try {
			if ('highlights' in CSS) {
				(CSS as any).highlights.delete('float-selection');
			}
		} catch (e) {
			// Graceful degradation
		}
	};

	const runAction = async (action: FloatingAction, inputContent = '') => {
		if (!model) {
			toast.error($i18n.t('Model not selected'));
			return;
		}

		selectedTextForDisplay = selectedText;
		userInputForDisplay = inputContent;
		prompt = buildPrompt(action, inputContent);
		floatingInputValue = '';

		responseContent = '';
		responseDone = false;
		responseUsage = null;

		// Apply dashed underline to selected text
		applySelectionHighlight();

		try {
			const requestBody = floatingChatRequestFactory
				? await floatingChatRequestFactory({
						modelId: model,
						messages: [
							...messages,
							{
								role: 'user',
								content: prompt
							}
						],
						stream: true
					})
				: {
						model,
						messages: [
							...messages,
							{
								role: 'user',
								content: prompt
							}
						].map((message) => ({
							role: message.role,
							content: message.content
						})),
						stream: true
					};

			const [res, controller] = await chatCompletion(localStorage.token, requestBody);
			requestController = controller;

			if (!(res && res.ok && res.body)) {
				toast.error($i18n.t('An error occurred while fetching the explanation'));
				return;
			}

			const textStream = await createOpenAITextStream(
				res.body,
				$settings?.splitLargeChunks ?? false
			);

			for await (const update of textStream) {
				const { value, image, done, error, usage } = update;
				if (done) {
					responseDone = true;
					await tick();
					autoScroll();
					break;
				}

				if (error) {
					console.error(error);
					toast.error($i18n.t('An error occurred while fetching the explanation'));
					break;
				}

				if (usage) {
					responseUsage = usage;
					continue;
				}

				const appendValue = image?.markdown ?? value;
				if (!appendValue) {
					continue;
				}

				responseContent += appendValue;
				autoScroll();
			}
		} catch (error) {
			if ((error as Error)?.name !== 'AbortError') {
				console.error(error);
				toast.error($i18n.t('An error occurred while fetching the explanation'));
			}
		}
	};

	const addHandler = async () => {
		onAdd({
			modelId: model,
			parentId: id,
			messages: [
				{
					role: 'user',
					content: prompt
				},
				{
					role: 'assistant',
					content: responseContent,
					...(responseUsage ? { usage: responseUsage } : {})
				}
			]
		});
	};

	export const closeHandler = () => {
		requestController?.abort();
		requestController = null;
		selectedAction = null;
		responseContent = null;
		responseDone = false;
		responseUsage = null;
		floatingInput = false;
		floatingInputValue = '';
		selectedTextForDisplay = '';
		userInputForDisplay = '';
		clearSelectionHighlight();
	};

	onDestroy(() => {
		requestController?.abort();
		clearSelectionHighlight();
	});
</script>

<div
	id={`floating-buttons-${id}`}
	class="absolute mt-1 text-xs z-9999 floating-panel-appear"
	style="display: none"
>
	{#if responseContent === null}
		{#if !floatingInput}
			<div
				class="flex flex-row gap-0.5 shrink-0 px-1.5 py-1 bg-white/95 dark:bg-gray-800/95 backdrop-blur-xl text-gray-600 dark:text-gray-300 rounded-xl shadow-sm border border-gray-200/50 dark:border-gray-700/50"
			>
				{#each resolvedActions as action}
					<button
						class="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl flex items-center gap-1 min-w-fit transition-all duration-200 hover:scale-110 active:scale-95 dark:hover:text-white hover:text-black"
						on:click={async () => {
							selectedText = window.getSelection().toString();
							selectedAction = action;
							if (action.input) {
								floatingInput = true;
								await tick();
								setTimeout(() => {
									const input = document.getElementById('floating-message-input');
									input?.focus();
								}, 0);
							} else {
								runAction(action);
							}
						}}
					>
						{#if action.icon}
							<svelte:component this={action.icon} className="size-3 shrink-0" />
						{/if}
						<div class="shrink-0">{action.label}</div>
					</button>
				{/each}
			</div>
		{:else}
			<div
				class="py-1 flex bg-white/95 dark:bg-gray-800/95 backdrop-blur-xl text-gray-600 dark:text-gray-300 border border-gray-200/50 dark:border-gray-700/50 w-72 rounded-full shadow-sm"
			>
				<input
					type="text"
					id="floating-message-input"
					class="ml-5 bg-transparent outline-hidden w-full flex-1 text-sm dark:text-gray-100"
					placeholder={$i18n.t('Ask a question')}
					bind:value={floatingInputValue}
					on:keydown={(e) => {
						if (e.key === 'Enter' && selectedAction) {
							floatingInput = false;
							runAction(selectedAction, floatingInputValue);
						}
					}}
				/>

				<div class="ml-1 mr-2">
					<button
						class="{floatingInputValue !== ''
							? 'bg-black text-white hover:bg-gray-900 dark:bg-white dark:text-black dark:hover:bg-gray-100 '
							: 'text-white bg-gray-200 dark:text-gray-900 dark:bg-gray-700 disabled'} transition rounded-full p-1.5 m-0.5 self-center"
						on:click={() => {
							if (selectedAction) {
								floatingInput = false;
								runAction(selectedAction, floatingInputValue);
							}
						}}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							fill="currentColor"
							class="size-4"
						>
							<path
								fill-rule="evenodd"
								d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z"
								clip-rule="evenodd"
							/>
						</svg>
					</button>
				</div>
			</div>
		{/if}
	{:else}
		<div class="relative bg-white/95 dark:bg-gray-800/95 backdrop-blur-xl dark:text-gray-100 rounded-xl shadow-lg border border-gray-200/50 dark:border-gray-700/50 w-80 max-w-full">
			<!-- Close button -->
			<button
				class="absolute top-2 right-2 p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-all duration-200 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 z-10"
				on:click={closeHandler}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-3.5">
					<path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
				</svg>
			</button>

			<!-- Quote section -->
			<div class="bg-blue-50/30 dark:bg-blue-900/10 rounded-t-xl px-3.5 py-3 pr-8">
				<div class="flex items-start gap-2">
					<div class="w-0.5 self-stretch rounded-full bg-blue-400/60 dark:bg-blue-500/50 shrink-0 min-h-4"></div>
					<div class="text-xs text-gray-500 dark:text-gray-400 line-clamp-3 italic leading-relaxed">
						{selectedTextForDisplay}
					</div>
				</div>
				{#if userInputForDisplay}
					<div class="mt-2 ml-2.5 text-sm text-gray-700 dark:text-gray-200">
						{userInputForDisplay}
					</div>
				{/if}
			</div>

			<!-- Response section -->
			<div class="px-3.5 py-3 w-full">
				<div class="max-h-80 overflow-y-auto w-full markdown-prose-xs" id="response-container">
					{#if (responseContent ?? '').trim() === ''}
						<Skeleton size="sm" />
					{:else}
						<Markdown id={`${id}-float-response`} content={responseContent ?? ''} />
					{/if}
				</div>

				{#if responseDone}
					<div class="flex justify-end pt-3">
						<button
							class="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200/60 bg-gray-100/80 px-3.5 py-1.5 text-xs leading-none font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-200 active:opacity-70 dark:border-gray-600/40 dark:bg-gray-700/60 dark:text-gray-300 dark:hover:bg-gray-600"
							on:click={addHandler}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 20 20"
								fill="currentColor"
								class="size-3.5 shrink-0"
							>
								<path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
							</svg>
							添加到对话
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.floating-panel-appear {
		animation: floating-fade-in 0.3s ease-out both;
	}

	@keyframes floating-fade-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	:global(::highlight(float-selection)) {
		background: transparent;
		text-decoration: underline dashed 1.5px;
		text-decoration-color: rgba(59, 130, 246, 0.4);
		text-underline-offset: 3px;
	}
</style>
