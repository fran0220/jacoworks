<script lang="ts">
	import { marked } from 'marked';
	import hljs from 'highlight.js';
	import 'highlight.js/styles/github-dark.css';
	import DOMPurify from 'dompurify';

	let { content }: { content: string } = $props();

	marked.setOptions({
		gfm: true,
		breaks: true
	});

	const renderer = new marked.Renderer();
	const originalCodeRenderer = renderer.code;

	renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
		const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
		const highlighted = hljs.highlight(text, { language }).value;
		const id = `code-${Math.random().toString(36).slice(2, 9)}`;
		return `<div class="code-block">
			<div class="code-header">
				<span class="code-lang">${language}</span>
				<button class="copy-btn" data-code-id="${id}">复制</button>
			</div>
			<pre><code id="${id}" class="hljs language-${language}">${highlighted}</code></pre>
		</div>`;
	};

	marked.use({ renderer });

	let html = $derived(DOMPurify.sanitize(marked.parse(content) as string, {
		ADD_TAGS: ['pre', 'code', 'img'],
		ADD_ATTR: ['class', 'id', 'data-code-id', 'src', 'alt', 'width', 'height', 'loading'],
	}));

	function handleClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (target.classList.contains('copy-btn')) {
			const codeId = target.getAttribute('data-code-id');
			if (!codeId) return;
			const codeEl = document.getElementById(codeId);
			if (!codeEl) return;
			navigator.clipboard.writeText(codeEl.textContent ?? '');
			target.textContent = '已复制';
			setTimeout(() => {
				target.textContent = '复制';
			}, 2000);
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="markdown-body" onclick={handleClick}>
	{@html html}
</div>

<style>
	.markdown-body {
		line-height: var(--leading-loose);
		word-break: break-word;
	}

	.markdown-body :global(p) {
		margin: 0.5em 0;
	}

	.markdown-body :global(p:first-child) {
		margin-top: 0;
	}

	.markdown-body :global(p:last-child) {
		margin-bottom: 0;
	}

	.markdown-body :global(ul),
	.markdown-body :global(ol) {
		padding-left: 1.5em;
		margin: 0.5em 0;
	}

	.markdown-body :global(blockquote) {
		border-left: 3px solid var(--accent);
		padding-left: var(--space-6);
		margin: 0.5em 0;
		color: var(--text-secondary);
	}

	.markdown-body :global(code) {
		font-family: var(--font-mono);
		font-size: 0.9em;
		background: var(--bg-tertiary);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
	}

	.markdown-body :global(.code-block) {
		margin: 0.75em 0;
		border-radius: var(--radius);
		overflow: hidden;
		border: 1px solid var(--border);
	}

	.markdown-body :global(.code-header) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-3) var(--space-6);
		background: var(--bg-tertiary);
		font-size: var(--text-xs);
	}

	.markdown-body :global(.code-lang) {
		color: var(--text-muted);
	}

	.markdown-body :global(.copy-btn) {
		padding: var(--space-1) var(--space-4);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--text-secondary);
		cursor: pointer;
		background: none;
		border: none;
		transition: color var(--duration-slow);
	}

	.markdown-body :global(.copy-btn:hover) {
		color: var(--text-primary);
	}

	.markdown-body :global(pre) {
		margin: 0;
		padding: var(--space-6) var(--space-8);
		overflow-x: auto;
		background: var(--bg-code);
	}

	.markdown-body :global(pre code) {
		background: none;
		padding: 0;
		font-size: var(--text-sm);
		line-height: var(--leading-normal);
	}

	.markdown-body :global(table) {
		border-collapse: collapse;
		margin: 0.5em 0;
		width: 100%;
	}

	.markdown-body :global(th),
	.markdown-body :global(td) {
		border: 1px solid var(--border);
		padding: var(--space-3) var(--space-6);
		text-align: left;
	}

	.markdown-body :global(th) {
		background: var(--bg-tertiary);
		font-weight: var(--font-semibold);
	}

	.markdown-body :global(hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 1em 0;
	}

	.markdown-body :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius);
		margin: 0.5em 0;
		cursor: pointer;
	}

	.markdown-body :global(a) {
		color: var(--accent);
	}

	.markdown-body :global(strong) {
		font-weight: var(--font-semibold);
	}
</style>
