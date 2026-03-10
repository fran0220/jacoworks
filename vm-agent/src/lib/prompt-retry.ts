/**
 * Retry logic for Pi SDK prompt execution to handle transient errors.
 * 
 * Common errors:
 * - "invalid request body" (protocol conversion issue in proxy)
 * - Network timeouts
 * - Session state corruption
 */

import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { log } from "./logger.js";

interface RetryOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  /** Errors that should trigger retry */
  retryableErrors?: RegExp[];
}

const DEFAULT_RETRYABLE_ERRORS = [
  /invalid request body/i,
  /network error/i,
  /timeout/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
];

/**
 * Execute a prompt with automatic retry on transient errors.
 */
export async function promptWithRetry(
  session: AgentSession,
  message: string,
  options?: Parameters<AgentSession["prompt"]>[1],
  retryOpts?: RetryOptions,
): Promise<void> {
  const maxRetries = retryOpts?.maxRetries ?? 2;
  const retryDelayMs = retryOpts?.retryDelayMs ?? 1000;
  const retryableErrors = retryOpts?.retryableErrors ?? DEFAULT_RETRYABLE_ERRORS;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await session.prompt(message, options);
      return; // Success
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorMsg = lastError.message;

      // Check if error is retryable
      const isRetryable = retryableErrors.some((pattern) => pattern.test(errorMsg));

      if (!isRetryable || attempt === maxRetries) {
        // Not retryable or max retries reached
        log.error("prompt failed (no retry)", {
          attempt: attempt + 1,
          error: errorMsg,
          retryable: isRetryable,
        });
        throw lastError;
      }

      // Retry after delay
      log.warn("prompt failed (will retry)", {
        attempt: attempt + 1,
        maxRetries,
        error: errorMsg,
        retryAfterMs: retryDelayMs,
      });

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw lastError!;
}

/**
 * Validate and sanitize prompt message to prevent protocol conversion errors.
 */
export function sanitizePromptMessage(message: string): string {
  // Remove null bytes (can cause protocol errors)
  let sanitized = message.replace(/\0/g, "");

  // Ensure valid UTF-8 (replace invalid sequences)
  sanitized = Buffer.from(sanitized, "utf-8").toString("utf-8");

  // Trim excessive whitespace
  sanitized = sanitized.trim();

  return sanitized;
}
