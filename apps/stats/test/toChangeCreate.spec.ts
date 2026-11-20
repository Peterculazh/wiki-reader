import { makeEditEvent } from './fixtures.js';
import { toChangeCreate } from '../src/domain/to-change.js';
import { type ChangeCreate } from '../src/domain/changes.repository.js';

describe('toChangeCreate: POSITIVE', () => {
  it('Should return change ready for create', () => {
    const editEvent = makeEditEvent();
    const value = JSON.stringify(editEvent);

    expect(toChangeCreate(value)).toEqual({
      eventId: editEvent.meta.id,
      eventTime: editEvent.meta.dt,
      wiki: editEvent.wiki,
      title: editEvent.title,
      type: editEvent.type,
      author: editEvent.user,
      namespace: editEvent.namespace,
      bot: editEvent.bot,
      length_old: editEvent.length.old,
      length_new: editEvent.length.new,
    } satisfies ChangeCreate);
  });

  it('Should return change with another type and length', () => {
    const editEvent = makeEditEvent({ type: 'new', length: { new: 500 } });
    const value = JSON.stringify(editEvent);

    expect(toChangeCreate(value)).toMatchObject({
      type: 'new',
      length_old: undefined,
      length_new: 500,
    });
  });
});
