import { parseAlertId, tierRank } from './alert-id';

describe('parseAlertId', () => {
  it('splits sender, identifier, and sent', () => {
    expect(parseAlertId('nws.example|abc-1|2024-08-15T22:30:00.000Z')).toEqual({
      sender: 'nws.example',
      identifier: 'abc-1',
      sentIso: '2024-08-15T22:30:00.000Z',
    });
  });

  it('keeps commas inside sender', () => {
    expect(parseAlertId('odd,sender|id-9|2024-01-01T00:00:00.000Z')).toEqual({
      sender: 'odd,sender',
      identifier: 'id-9',
      sentIso: '2024-01-01T00:00:00.000Z',
    });
  });
});

describe('tierRank', () => {
  it('ranks A highest', () => {
    expect(tierRank('A')).toBeGreaterThan(tierRank('B'));
    expect(tierRank('B')).toBeGreaterThan(tierRank('C'));
    expect(tierRank('C')).toBeGreaterThan(tierRank('D'));
  });
});
