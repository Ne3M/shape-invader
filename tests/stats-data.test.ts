import { describe, expect, it } from 'vitest';
import { buildPlayers, buildSessions, byLevel, parseCsv, waveBuckets } from '../tools/stats-data';

const HEAD = '"website_id","session_id","event_id","url_path","event_name","data_key","string_value","number_value","date_value","data_type","created_at","job_id"';
const row = (event: string, key: string, value: string | number | boolean, at = '2026-11-21 23:04:03') => {
  const [s, n, type] = typeof value === 'number' ? [`${value}.0000`, String(value), 2] : typeof value === 'boolean' ? [String(value), '\\N', 3] : [value, '\\N', 1];
  return `"w","s","${event}","/","session","${key}","${s}",${n},\\N,${type},"${at}",\\N`;
};

describe('stats dashboard data', () => {
  it('parses quoted fields and Umami empty values', () => {
    expect(parseCsv('"a","b,c",\\N\r\n"x ""y""",,1\n')).toEqual([
      ['a', 'b,c', null],
      ['x "y"', '', '1'],
    ]);
  });

  it('rebuilds sessions from both formats and merges duplicate exports', () => {
    const v2 = [row('e1', 'v', 2), row('e1', 'playerId', 'p1'), row('e1', 'games', 3), row('e1', 'pwa', true), row('e1', 'n1Score', 500), row('e1', 'n1Stars', 3), row('e1', 'levelsPlayed', '1,1,2'), row('e1', 'levelsWon', '1')];
    const v3 = [row('e2', 'v', 3), row('e2', 'playerId', 'p1'), row('e2', 'games', 2), row('e2', 'nScores', '400,900,0,0,0,0,0,0,0,0', '2026-11-22 10:00:00'), row('e2', 'nStars', '2,1,0,0,0,0,0,0,0,0'), row('e2', 'xEndlessWave', 7)];
    const file = [HEAD, ...v2, ...v3].join('\n');
    const sessions = buildSessions([{ name: 'a.csv', text: file }, { name: 'copy/a.csv', text: file }]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ games: 3, pwa: true, levelsPlayed: [1, 1, 2] });
    expect(sessions[0].normal.scores.slice(0, 2)).toEqual([500, 0]);
    expect(sessions[1].normal.stars.slice(0, 2)).toEqual([2, 1]);

    const [p] = buildPlayers(sessions);
    expect(p).toMatchObject({ id: 'p1', sessions: 2, games: 5 });
    // Best of each record across the player's sessions.
    expect(p.normal.scores.slice(0, 2)).toEqual([500, 900]);
    expect(p.normal.stars.slice(0, 2)).toEqual([3, 1]);
    expect(p.expert.endlessWave).toBe(7);

    const [l1, l2] = byLevel(sessions, [p]);
    expect(l1).toMatchObject({ plays: 2, wins: 1, clearedNormal: 1, bestNormal: 500 });
    expect(l2).toMatchObject({ plays: 1, wins: 0, clearedNormal: 1 });
  });

  it('groups endless waves by 5', () => {
    expect(waveBuckets([0, 3, 5, 6, 14])).toEqual([
      { label: '1–5', value: 2 },
      { label: '6–10', value: 1 },
      { label: '11–15', value: 1 },
    ]);
  });
});
