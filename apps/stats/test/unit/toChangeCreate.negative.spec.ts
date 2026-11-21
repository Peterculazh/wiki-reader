import { makeEditEvent } from '../fixtures.js';
import { toChangeCreate } from '../../src/domain/to-change.js';

describe('toChangeCreate: NEGATIVE', () => {
  it.each([
    ['empty value', null],
    ['malformed JSON', '{oops'],
    ['no user', JSON.stringify(makeEditEvent({ user: undefined }))],
    ['no meta', JSON.stringify(makeEditEvent({ meta: undefined }))],
    [
      'malformed meta.dt',
      JSON.stringify(
        makeEditEvent({ meta: { ...makeEditEvent().meta, dt: 'not-a-date' } }),
      ),
    ],
    [
      'malformed namespace',
      JSON.stringify(
        makeEditEvent({
          namespace: '0',
        }),
      ),
    ],
    ['malformed type', JSON.stringify(makeEditEvent({ type: undefined }))],
    [
      'no meta.dt',
      JSON.stringify(
        makeEditEvent({ meta: { ...makeEditEvent().meta, dt: undefined } }),
      ),
    ],
  ])('skips a message with %s', (_reason, value) => {
    const warn = vi.fn();
    expect(toChangeCreate(value, warn)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});
