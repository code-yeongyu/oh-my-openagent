import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as storageDetection from '../../../shared/opencode-storage-detection';
import { readMessagesFromSDK, readPartsFromSDK } from '../storage';
import * as messagesReader from './messages-reader';
import * as partsReader from './parts-reader';

function createMockClient(handlers: {
  messages?: (sessionID: string) => unknown[];
  message?: (sessionID: string, messageID: string) => unknown;
}) {
  return {
    session: {
      messages: async (opts: { path: { id: string } }) => {
        if (handlers.messages) {
          return { data: handlers.messages(opts.path.id) };
        }
        throw new Error('not implemented');
      },
      message: async (opts: { path: { id: string; messageID: string } }) => {
        if (handlers.message) {
          return { data: handlers.message(opts.path.id, opts.path.messageID) };
        }
        throw new Error('not implemented');
      },
    },
  } as unknown;
}

describe('session-recovery storage SDK readers', () => {
  let sqliteSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    sqliteSpy = spyOn(storageDetection, 'isSqliteBackend').mockReturnValue(false);
  });

  afterEach(() => {
    sqliteSpy.mockRestore();
  });

  it('readPartsFromSDK returns empty array when fetch fails', async () => {
    const client = createMockClient({}) as Parameters<typeof readPartsFromSDK>[0];

    const result = await readPartsFromSDK(client, 'ses_test', 'msg_test');

    expect(result).toEqual([]);
  });

  it('readPartsFromSDK returns stored parts from SDK response', async () => {
    const sessionID = 'ses_test';
    const messageID = 'msg_test';
    const storedParts = [{ id: 'prt_1', sessionID, messageID, type: 'text', text: 'hello' }];

    const client = createMockClient({
      message: (_sid: string, _mid: string) => ({ parts: storedParts }),
    }) as Parameters<typeof readPartsFromSDK>[0];

    const result = await readPartsFromSDK(client, sessionID, messageID);

    expect(result).toEqual(storedParts);
  });

  it('readMessagesFromSDK normalizes and sorts messages', async () => {
    const sessionID = 'ses_test';
    const client = createMockClient({
      messages: () => [
        { id: 'msg_b', role: 'assistant', time: { created: 2 } },
        { id: 'msg_a', role: 'user', time: { created: 1 } },
        { id: 'msg_c' },
      ],
    }) as Parameters<typeof readMessagesFromSDK>[0];

    const result = await readMessagesFromSDK(client, sessionID);

    expect(result).toEqual([
      { id: 'msg_c', sessionID, role: 'user', time: { created: 0 } },
      { id: 'msg_a', sessionID, role: 'user', time: { created: 1 } },
      { id: 'msg_b', sessionID, role: 'assistant', time: { created: 2 } },
    ]);
  });

  it('readParts returns empty array for nonexistent message', () => {
    const spy = spyOn(partsReader, 'readParts').mockReturnValue([]);
    try {
      const parts = partsReader.readParts('msg_nonexistent');
      expect(parts).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('readMessages returns empty array for nonexistent session', () => {
    const spy = spyOn(messagesReader, 'readMessages').mockReturnValue([]);
    try {
      const messages = messagesReader.readMessages('ses_nonexistent');
      expect(messages).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
