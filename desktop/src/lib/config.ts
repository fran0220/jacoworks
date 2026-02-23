export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://api.xiaomao.chat:8090';
export const DEFAULT_MODEL = 'proxy-claude/claude-sonnet-4-6';
export const DEFAULT_SYSTEM_PROMPT = '你是 JAcoworks AI 助手，帮助企业员工完成日常办公任务。';

export const MODEL_OPTIONS = [
	{ value: 'proxy-claude/claude-sonnet-4-6', label: 'Sonnet 4.6' },
	{ value: 'proxy-claude/claude-opus-4-6', label: 'Opus 4.6' },
	{ value: 'proxy-claude/claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
	{ value: 'proxy-gpt/gpt-5.3-codex', label: 'GPT-5.3 Codex' },
	{ value: 'proxy-gpt/gpt-5.2', label: 'GPT-5.2' },
	{ value: 'proxy-gemini/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
	{ value: 'proxy-gemini/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
	{ value: 'proxy-grok/grok-4.20-beta', label: 'Grok 4.20' },
	{ value: 'proxy-grok/grok-4.1-fast', label: 'Grok 4.1 Fast' },
] as const;
