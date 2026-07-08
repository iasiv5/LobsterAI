import crypto from 'node:crypto';

import type { CoworkMessage } from '../../../coworkStore';
import {
  extractGatewayMessageText,
  shouldSuppressHeartbeatText,
} from '../../openclawHistory';

export type SubagentCoworkMessage = CoworkMessage;

export interface ParseSubagentGatewayHistoryOptions {
  createId?: () => string;
  startTimestamp?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

/**
 * Resolve tool input from a tool_use block, handling multiple field names and formats.
 * The gateway can return tool arguments as:
 *  - `input` (Anthropic format, object)
 *  - `args` (OpenClaw format, object)
 *  - `arguments` (OpenAI format, may be a JSON string)
 */
const resolveToolInput = (block: Record<string, unknown>): Record<string, unknown> => {
  if (isRecord(block.input)) return block.input;
  if (isRecord(block.args)) return block.args;
  if (isRecord(block.arguments)) return block.arguments;
  if (typeof block.arguments === 'string') {
    try {
      const parsed = JSON.parse(block.arguments);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Ignore malformed tool input payloads from gateway history.
    }
  }
  if (typeof block.input === 'string') {
    try {
      const parsed = JSON.parse(block.input);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Ignore malformed tool input payloads from gateway history.
    }
  }
  return {};
};

export const parseSubagentGatewayHistoryMessages = (
  historyMessages: unknown[],
  options: ParseSubagentGatewayHistoryOptions = {},
): SubagentCoworkMessage[] => {
  const createId = options.createId ?? (() => crypto.randomUUID());
  let timestamp = options.startTimestamp ?? Date.now() - historyMessages.length * 1000;
  const messages: SubagentCoworkMessage[] = [];

  for (const raw of historyMessages) {
    if (!isRecord(raw)) continue;
    const role = typeof raw.role === 'string' ? raw.role.trim().toLowerCase() : '';

    if (role === 'user' || role === 'assistant' || role === 'system') {
      const text = extractGatewayMessageText(raw).trim();

      if (role === 'assistant' && Array.isArray(raw.content)) {
        if (text && !shouldSuppressHeartbeatText(role, text)) {
          messages.push({
            id: createId(),
            type: 'assistant',
            content: text,
            timestamp: timestamp++,
          });
        }
        for (const block of raw.content as unknown[]) {
          if (!isRecord(block)) continue;
          const blockType = typeof block.type === 'string' ? block.type : '';
          if (blockType === 'tool_use' || blockType === 'tool_call' || blockType === 'toolCall') {
            const toolName = typeof block.name === 'string' ? block.name : 'tool';
            const toolInput = resolveToolInput(block);
            const toolUseId = typeof block.id === 'string' ? block.id : null;
            messages.push({
              id: createId(),
              type: 'tool_use',
              content: '',
              timestamp: timestamp++,
              metadata: { toolName, toolInput, toolUseId },
            });
          }
        }
      } else if (role === 'user' && Array.isArray(raw.content)) {
        for (const block of raw.content as unknown[]) {
          if (!isRecord(block)) continue;
          const blockType = typeof block.type === 'string' ? block.type : '';
          if (blockType === 'tool_result') {
            const resultText = typeof block.content === 'string'
              ? block.content
              : extractGatewayMessageText(block).trim();
            const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null;
            const isError = block.is_error === true;
            if (resultText) {
              messages.push({
                id: createId(),
                type: 'tool_result',
                content: resultText,
                timestamp: timestamp++,
                metadata: {
                  toolResult: resultText,
                  toolUseId,
                  isError: isError || undefined,
                },
              });
            }
          }
        }
        if (text && !shouldSuppressHeartbeatText('user', text)) {
          messages.push({
            id: createId(),
            type: 'user',
            content: text,
            timestamp: timestamp++,
          });
        }
      } else if (text && !shouldSuppressHeartbeatText(role as 'user' | 'assistant' | 'system', text)) {
        messages.push({
          id: createId(),
          type: role === 'system' ? 'system' : role as 'user' | 'assistant',
          content: text,
          timestamp: timestamp++,
        });
      }
      continue;
    }

    if (role === 'tool_result' || role === 'toolresult' || role === 'tool' || role === 'function') {
      const text = extractGatewayMessageText(raw).trim();
      const toolName = typeof raw.toolName === 'string' ? raw.toolName
        : typeof raw.tool_name === 'string' ? raw.tool_name
          : typeof raw.name === 'string' ? raw.name : '';
      const toolUseId = typeof raw.tool_use_id === 'string' ? raw.tool_use_id
        : typeof raw.toolCallId === 'string' ? raw.toolCallId : null;
      if (text) {
        messages.push({
          id: createId(),
          type: 'tool_result',
          content: text,
          timestamp: timestamp++,
          metadata: { toolName: toolName || undefined, toolResult: text, toolUseId },
        });
      }
      continue;
    }

    if (!role && Array.isArray(raw.content)) {
      for (const block of raw.content as unknown[]) {
        if (!isRecord(block)) continue;
        const blockType = typeof block.type === 'string' ? block.type : '';
        if (blockType === 'tool_use' || blockType === 'tool_call' || blockType === 'toolCall') {
          const toolName = typeof block.name === 'string' ? block.name : 'tool';
          const toolInput = resolveToolInput(block);
          const toolUseId = typeof block.id === 'string' ? block.id : null;
          messages.push({
            id: createId(),
            type: 'tool_use',
            content: '',
            timestamp: timestamp++,
            metadata: { toolName, toolInput, toolUseId },
          });
        } else if (blockType === 'text' && typeof block.text === 'string' && block.text.trim()) {
          messages.push({
            id: createId(),
            type: 'assistant',
            content: block.text.trim(),
            timestamp: timestamp++,
          });
        }
      }
    }
  }

  return messages;
};
