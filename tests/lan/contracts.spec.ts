import { test, expect, type APIRequestContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseBackup, type BackupFile } from '../../src/domain/backup';
import { calendarQuantity } from '../../src/domain/calendarQuantity';
import { addDays, type AppState, type Envelope } from '../../src/domain/model';
import { approve, proposeRestart, proposeRemainingAdjustment } from '../../src/domain/planner/proposal';
import {
  correctAndAdjust,
  currentProgressAdjustment,
  reconcilePlanning,
  recordAndAdjust,
} from '../../src/domain/progressAdjustment';
import { activePlanWork } from '../../src/domain/progressAllocation';
import { remainingWork } from '../../src/domain/remainingWork';
import {
  adjustmentContext,
  adjustmentDay,
  adjustmentFixture,
  adjustmentReport,
  restartFixture,
  remainingPlacementFixture,
  elapsedPlacementFixture,
} from '../fixtures/adjustment';

// The server and this direct IPC path share only this dedicated test database.
// Direct IPC calls the same Rust db/backup functions as Tauri commands.
const database = resolve('.test-data/lan-e2e/studyplan.sqlite3');
const executable = resolve('src-tauri/target/debug/studyplan_lan_bridge.exe');
const base = 'http://127.0.0.1:4182/studyplan-lan/api/';
const headers = {
  Authorization: `Bearer ${'a'.repeat(64)}`,
  Origin: 'http://127.0.0.1:4182',
};
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const requestId = () => `lan-contract-${randomUUID()}`;

interface ApiPacket<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

async function http<T>(
  request: APIRequestContext,
  method: string,
  params: object = {},
): Promise<T> {
  const response = await request.post(`${base}${method}`, { headers, data: params });
  const packet = (await response.json()) as ApiPacket<T>;
  expect(response.ok(), packet.error).toBe(true);
  expect(packet.ok, packet.error).toBe(true);
  return packet.value as T;
}

/** Reopening the helper for each operation also checks durable SQLite reads. */
function direct<T>(method: string, params: object = {}): Promise<T> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, ['--database', database], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let error = '';
    let reply: { ok: boolean; result?: T; error?: string } | undefined;
    let settled = false;
    const finish = (failure?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (!reply?.ok) reject(new Error(reply?.error ?? error ?? 'Bridge response missing'));
      else resolveResult(reply.result as T);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Isolated SQLite bridge timed out'));
    }, 30_000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      error += chunk;
    });
    child.on('error', finish);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        const item = JSON.parse(line) as { id: number; ok: boolean; result?: T; error?: string };
        if (item.id === 0) {
          if (!item.ok) {
            reply = item;
            child.stdin.end();
          } else child.stdin.end(`${JSON.stringify({ id: 1, method, params })}\n`);
        } else if (item.id === 1) reply = item;
      } catch (cause) {
        child.kill();
        finish(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
    child.on('close', (code) => {
      lines.close();
      finish(code === 0 ? undefined : new Error(error || `Bridge exited with ${code}`));
    });
  });
}

async function seed(state: AppState): Promise<Envelope> {
  const expected = await direct<number>('revision');
  const packet: BackupFile = {
    format: 'StudyPlanBackup',
    version: 1,
    createdAt: adjustmentContext.timestamp,
    appVersion: '0.5.1',
    data: state,
  };
  parseBackup(JSON.stringify(packet));
  return direct<Envelope>('restore_backup', {
    expected,
    requestId: requestId(),
    text: JSON.stringify(packet),
  });
}

async function save(
  request: APIRequestContext,
  before: Envelope,
  data: AppState,
  transport: 'http' | 'direct' = 'http',
): Promise<Envelope> {
  const params = { expected: before.revision, requestId: requestId(), data };
  const stored =
    transport === 'http'
      ? await http<Envelope>(request, 'commit_state', params)
      : await direct<Envelope>('commit_state', params);
  expect(stored.revision).toBe(before.revision + 1);
  expect(stored.data).toEqual(json(data));
  expect(await direct<Envelope>('load_state')).toEqual(stored);
  expect(await http<Envelope>(request, 'load_state')).toEqual(stored);
  return stored;
}

function quantities(
  state: AppState,
  date: string,
  completed: number,
  today: number,
  future: number,
  unplaced = 0,
) {
  const row = remainingWork(state, date).find((r) => r.materialId === 'book' && r.round === 0)!;
  expect(row).toMatchObject({
    total: 30,
    completed,
    remaining: 30 - completed,
    allocated: today + future,
    unplaced,
    balanced: true,
  });
  const sessions = activePlanWork(state, date).filter(
    (s) => s.materialId === 'book' && s.round === 0,
  );
  expect(sessions.filter((s) => s.date === date).reduce((sum, s) => sum + s.count, 0)).toBe(today);
  expect(sessions.filter((s) => s.date > date).reduce((sum, s) => sum + s.count, 0)).toBe(future);
  for (const value of remainingWork(state, date)) {
    expect(value.total, `${value.materialId}/${value.round}: T=C+A+U`).toBe(
      value.completed + value.allocated + value.unplaced,
    );
    expect(value.remaining).toBe(value.allocated + value.unplaced);
  }
}

function placements(state: AppState, date: string) {
  return activePlanWork(state, date)
    .map(({ date, start, end, materialId, round, count, fixed, kind }) => ({
      date,
      start,
      end,
      materialId,
      round,
      count,
      fixed,
      kind,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

test.beforeEach(({ request }, info) => {
  void request;
  test.skip(
    info.project.name !== 'wide' && !info.title.startsWith('LAN画面'),
    'Transport contracts run once; UI tests cover both widths.',
  );
});

test('LAN画面で再配置待ち37問と他教材をまとめて確認し、承認・再読込後も数量を保持する', async ({ page, request }, info) => {
  const source = elapsedPlacementFixture(undefined, true);
  await seed(source);
  await page.clock.install({ time: new Date(adjustmentContext.timestamp) });
  await page.goto(`./#key=${'a'.repeat(64)}`);
  const row = page.locator('.daily-record-row').filter({ hasText: '対象問題集' });
  await expect(row).toContainText(/残り\s*160問/);
  await expect(row).toContainText(/実行可能\s*123問/);
  await expect(row).toContainText(/再配置待ち\s*37問/);
  await expect(row).not.toContainText('元の配置');
  await row.getByRole('button', { name: '残りの配置を調整', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('配置する開始日')).toBeFocused();
  await expect(page.getByRole('button', { name: '配置案を確認', exact: true })).toBeDisabled();
  const include = page.getByRole('button', { name: '経過済みの未消化分をすべて含める', exact: true });
  await include.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '配置案を確認', exact: true }).click();
  const proposal = page.getByRole('region', { name: '選択した残量の配置案' });
  await expect(proposal).toContainText('対象 37問');
  await expect(proposal).toContainText('別教材');
  await expect(proposal).toContainText('別周回教材');
  expect((await http<Envelope>(request, 'load_state')).data.plan).toEqual(source.plan);
  await page.screenshot({ path: info.outputPath('lan-elapsed-proposal.png'), fullPage: true });
  await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
  await expect(page.locator('.save-status')).toContainText('Windowsに保存済み');
  const approved = await http<Envelope>(request, 'load_state');
  expect(approved.data.proposal).toBeNull();
  expect(approved.data.records).toEqual([]);
  expect(approved.data.plan!.sessions.filter((s) => s.id.startsWith('future-'))).toEqual(source.plan!.sessions.filter((s) => s.id.startsWith('future-')));
  expect(remainingWork(approved.data, adjustmentDay, 720).filter((r) => r.remaining > 0).map((r) => [r.remaining, r.allocated, r.unplaced, r.balanced])).toEqual([[160, 160, 0, true], [3, 3, 0, true], [4, 4, 0, true]]);
  expect(await direct<Envelope>('load_state')).toEqual(approved);
  await page.reload();
  await page.getByRole('button', { name: '今日', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今日', exact: true })).toBeVisible();
  expect(await http<Envelope>(request, 'load_state')).toEqual(approved);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('対象5問の部分再配置を両保存経路で共有し、再送・競合・古い案の承認を保護する', async ({ request }) => {
  const source = remainingPlacementFixture();
  source.plan!.comparisonSessionIds = ['a-done'];
  let stored = await seed(source);
  const proposal = proposeRemainingAdjustment(stored.data, [{ kind: 'session', sessionId: 'b-target' }], adjustmentDay, adjustmentContext);
  stored = await save(request, stored, proposal);
  expect(stored.data.records).toEqual(source.records);
  const approved = approve(stored.data, false, adjustmentContext);
  const params = { expected: stored.revision, requestId: requestId(), data: approved };
  const committed = await http<Envelope>(request, 'commit_state', params);
  expect(await direct<Envelope>('load_state')).toEqual(committed);
  expect(committed.data.plan!.comparisonSessionIds).toEqual(['a-done']);
  expect(remainingWork(committed.data, adjustmentDay).find((r) => r.materialId === 'b')).toMatchObject({ remaining: 10, allocated: 10, unplaced: 0, balanced: true });
  expect(committed.data.plan!.sessions.find((s) => s.id === 'b-keep')).toEqual(source.plan!.sessions.find((s) => s.id === 'b-keep'));
  const changed = await save(request, committed, recordAndAdjust(committed.data, { ...adjustmentReport(2, 'after-adjustment'), materialId: 'b' }, adjustmentContext), 'direct');
  expect(changed.data.records.find((r) => r.materialId === 'a')).toEqual(source.records[0]);
  expect(await http<Envelope>(request, 'commit_state', params)).toEqual(committed);
  expect(await direct<Envelope>('load_state')).toEqual(changed);
  const conflict = await request.post(`${base}commit_state`, { headers, data: { ...params, requestId: requestId() } });
  expect(conflict.status()).toBe(409);
  expect(await direct<Envelope>('load_state')).toEqual(changed);

  stored = await seed(source);
  stored = await save(request, stored, proposeRemainingAdjustment(stored.data, [{ kind: 'session', sessionId: 'b-target' }], adjustmentDay, adjustmentContext));
  stored = await save(request, stored, recordAndAdjust(stored.data, { ...adjustmentReport(1, 'while-proposed'), materialId: 'b' }, adjustmentContext), 'direct');
  const reloaded = await http<Envelope>(request, 'load_state');
  expect(() => approve(reloaded.data, false, adjustmentContext)).toThrow('案の作成後');
  expect(reloaded).toEqual(stored);
  expect(reloaded.data.records.find((r) => r.materialId === 'a')).toEqual(source.records[0]);
});

test('LANとDesktop保存経路で部分・追加・超過・訂正・取消の数量を共有する', async ({ request }) => {
  let stored = await seed(adjustmentFixture());
  const untouched = stored.data
    .plan!.sessions.filter((s) => s.materialId !== 'book' || s.round !== 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  quantities(stored.data, adjustmentDay, 0, 6, 24);

  stored = await save(
    request,
    stored,
    recordAndAdjust(stored.data, adjustmentReport(4, 'four'), adjustmentContext),
  );
  quantities(stored.data, adjustmentDay, 4, 2, 24);
  stored = await save(
    request,
    stored,
    recordAndAdjust(stored.data, adjustmentReport(2, 'two'), adjustmentContext),
    'direct',
  );
  quantities(stored.data, adjustmentDay, 6, 0, 24);
  const oneEntry = recordAndAdjust(
    adjustmentFixture(),
    adjustmentReport(6, 'six-at-once'),
    adjustmentContext,
  );
  expect(placements(stored.data, adjustmentDay)).toEqual(placements(oneEntry, adjustmentDay));
  expect(remainingWork(stored.data, adjustmentDay)).toEqual(remainingWork(oneEntry, adjustmentDay));

  stored = await save(
    request,
    stored,
    recordAndAdjust(stored.data, adjustmentReport(2, 'extra'), adjustmentContext),
  );
  quantities(stored.data, adjustmentDay, 8, 0, 22);
  stored = await save(
    request,
    stored,
    correctAndAdjust(stored.data, 'extra', 2, true, adjustmentContext),
    'direct',
  );
  quantities(stored.data, adjustmentDay, 6, 0, 24);
  stored = await save(
    request,
    stored,
    correctAndAdjust(stored.data, 'four', 3, false, adjustmentContext),
  );
  quantities(stored.data, adjustmentDay, 5, 1, 24);
  expect(stored.data.records.filter((r) => !r.cancelled).map((r) => r.count)).toEqual([3, 2]);
  expect(
    stored.data
      .plan!.sessions.filter((s) => s.materialId !== 'book' || s.round !== 0)
      .sort((a, b) => a.id.localeCompare(b.id)),
  ).toEqual(untouched);
  expect(reconcilePlanning(stored.data, adjustmentContext)).toEqual(stored.data);
});

test('日付越えの未報告6問を再配分し、今日の部分記録と過去比較を両経路で保持する', async ({
  request,
}) => {
  let stored = await seed(adjustmentFixture());
  const date = addDays(adjustmentDay, 1);
  const context = {
    ...adjustmentContext,
    date,
    timestamp: `${date}T03:00:00.000Z`,
    idPrefix: 'rollover',
  };
  stored = await save(request, stored, reconcilePlanning(stored.data, context), 'direct');
  quantities(stored.data, date, 0, 6, 24);
  expect(stored.data.records).toEqual([]);
  stored = await save(
    request,
    stored,
    recordAndAdjust(stored.data, { ...adjustmentReport(4), date }, context),
  );
  quantities(stored.data, date, 4, 2, 24);
  expect(
    calendarQuantity(stored.data, adjustmentDay, date).rows.find((r) => r.materialId === 'book'),
  ).toMatchObject({
    planned: 6,
    actual: 0,
    reported: false,
  });
  expect(reconcilePlanning(stored.data, context)).toEqual(stored.data);
});

test('仕切り直しの候補・承認・旧未配置とバックアップ復元をSQLiteの同じ状態へ保存する', async ({
  request,
}) => {
  let stored = await seed(restartFixture());
  quantities(stored.data, adjustmentDay, 4, 0, 20, 6);
  const from = addDays(adjustmentDay, 3);
  stored = await save(request, stored, proposeRestart(stored.data, from, adjustmentContext));
  quantities(stored.data, adjustmentDay, 4, 0, 20, 6);
  const proposed = stored.data.proposal!.plan;
  expect(
    proposed.sessions.filter((s) => s.kind === 'study').reduce((sum, s) => sum + s.count, 0),
  ).toBe(26);
  expect(proposed.shortfalls).toEqual([]);
  stored = await save(request, stored, approve(stored.data, false, adjustmentContext), 'direct');
  quantities(stored.data, adjustmentDay, 4, 0, 26);
  expect(stored.data.plan?.allocationStart).toBe(from);
  expect(activePlanWork(stored.data, adjustmentDay).every((s) => s.date >= from)).toBe(true);
  expect(stored.data.history[0].sessions.map((s) => s.count)).toEqual([10, 10]);
  expect(stored.data.records).toEqual(restartFixture().records);

  const packet = await http<BackupFile>(request, 'export_backup');
  expect(parseBackup(JSON.stringify(packet)).data).toEqual(stored.data);
  await direct('validate_backup', { text: JSON.stringify(packet) });
  const previous = stored;
  stored = await save(
    request,
    stored,
    recordAndAdjust(stored.data, adjustmentReport(1, 'later'), adjustmentContext),
  );
  const restored = await http<Envelope>(request, 'restore_backup', {
    expected: stored.revision,
    requestId: requestId(),
    text: JSON.stringify(packet),
  });
  expect(restored.data).toEqual(previous.data);
  expect(await direct<Envelope>('load_state')).toEqual(restored);
  expect((await direct<BackupFile>('load_restore_point')).data).toEqual(stored.data);
  const undone = await direct<Envelope>('undo_restore', {
    expected: restored.revision,
    requestId: requestId(),
  });
  expect(undone.data).toEqual(stored.data);
  expect(await http<Envelope>(request, 'load_state')).toEqual(undone);
});

test('同じ版を開いたLANとDesktopの競合では後書きで記録を消さない', async ({ request }) => {
  const original = await seed(adjustmentFixture());
  const lan = recordAndAdjust(original.data, adjustmentReport(4, 'lan-record'), adjustmentContext);
  const desktop = recordAndAdjust(
    original.data,
    adjustmentReport(2, 'desktop-record'),
    adjustmentContext,
  );
  const winner = await save(request, original, lan);
  await expect(
    direct('commit_state', {
      expected: original.revision,
      requestId: requestId(),
      data: desktop,
    }),
  ).rejects.toThrow('別の操作でデータが更新');
  const rejected = await request.post(`${base}commit_state`, {
    headers,
    data: { expected: original.revision, requestId: requestId(), data: desktop },
  });
  expect(rejected.status()).toBe(409);
  expect((await rejected.json()).ok).toBe(false);
  expect(await direct<Envelope>('load_state')).toEqual(winner);
  const reloaded = await http<Envelope>(request, 'load_state');
  const merged = await save(
    request,
    reloaded,
    recordAndAdjust(reloaded.data, adjustmentReport(2, 'desktop-record'), adjustmentContext),
    'direct',
  );
  quantities(merged.data, adjustmentDay, 6, 0, 24);
  expect(merged.data.records.map((r) => r.id)).toEqual(['lan-record', 'desktop-record']);
});

test('応答を失った要求の再送は元の保存結果を返し、他端末更新後の上書きを許さない', async ({
  request,
}) => {
  const original = await seed(adjustmentFixture());
  const data = recordAndAdjust(original.data, adjustmentReport(4, 'retried'), adjustmentContext);
  const params = { expected: original.revision, requestId: requestId(), data };
  const first = await http<Envelope>(request, 'commit_state', params);
  expect(await http<Envelope>(request, 'commit_state', params)).toEqual(first);
  const second = await save(
    request,
    first,
    recordAndAdjust(first.data, adjustmentReport(2, 'other-client'), adjustmentContext),
    'direct',
  );
  const replayed = await http<Envelope>(request, 'commit_state', params);
  expect(replayed).toEqual(first);
  expect(await direct<Envelope>('load_state')).toEqual(second);
  const staleFollowup = await request.post(`${base}commit_state`, {
    headers,
    data: {
      expected: replayed.revision,
      requestId: requestId(),
      data: recordAndAdjust(replayed.data, adjustmentReport(1, 'stale'), adjustmentContext),
    },
  });
  expect(staleFollowup.status()).toBe(409);
  const latest = await http<Envelope>(request, 'load_state');
  expect(latest).toEqual(second);
  quantities(latest.data, adjustmentDay, 6, 0, 24);
  expect(latest.data.records.filter((r) => r.id === 'retried')).toHaveLength(1);
});

test('LANもDesktopも1440分境界・保護周回・旧0分予定の保存契約を共有する', async ({ request }) => {
  const fixture = adjustmentFixture();
  fixture.settings.materials[0].rounds[1].completed = 7;
  fixture.settings.materials[0].rounds[0].minutes = 1440;
  fixture.records = [adjustmentReport(6, 'legacy-completed')];
  fixture.plan!.sessions[0].count = 0;
  fixture.plan!.sessions[0].end = fixture.plan!.sessions[0].start;
  fixture.plan!.sessions[8].count = 5;
  fixture.plan!.sessions[8].end = fixture.plan!.sessions[8].start + 15;
  fixture.plan!.sessions[9].count = 0;
  fixture.plan!.sessions[9].end = fixture.plan!.sessions[9].start;
  let stored = await seed(fixture);
  quantities(stored.data, adjustmentDay, 6, 0, 24);
  stored = await save(request, stored, { ...stored.data, theme: 'sky' });
  const packet = await http<BackupFile>(request, 'export_backup');
  expect(parseBackup(JSON.stringify(packet)).data).toEqual(stored.data);
  await direct('validate_backup', { text: JSON.stringify(packet) });

  for (const invalid of ['minutes', 'rounds'] as const) {
    const data = structuredClone(stored.data);
    if (invalid === 'minutes') data.settings.materials[0].rounds[0].minutes = 1441;
    else data.settings.materials[0].rounds = data.settings.materials[0].rounds.slice(0, 1);
    const params = { expected: stored.revision, requestId: requestId(), data };
    const response = await request.post(`${base}commit_state`, { headers, data: params });
    expect(response.ok()).toBe(false);
    const failure = (await response.json()) as ApiPacket<Envelope>;
    expect(failure.ok).toBe(false);
    expect(failure.error).toBeTruthy();
    await expect(direct('commit_state', { ...params, requestId: requestId() })).rejects.toThrow();
    expect(await direct<Envelope>('load_state')).toEqual(stored);
  }
});

test('明示0問・部分記録で固定予定を保持し、固定に達する超過は調整未反映として保存する', async ({
  request,
}) => {
  const fixture = adjustmentFixture();
  fixture.plan!.sessions[1].fixed = true;
  const fixed = structuredClone(fixture.plan!.sessions[1]);
  let stored = await seed(fixture);
  expect(
    calendarQuantity(stored.data, adjustmentDay, adjustmentDay).rows.find(
      (r) => r.materialId === 'book',
    ),
  ).toMatchObject({
    reported: false,
    actual: 0,
  });
  stored = await save(
    request,
    stored,
    recordAndAdjust(stored.data, adjustmentReport(0, 'explicit-zero'), adjustmentContext),
  );
  quantities(stored.data, adjustmentDay, 0, 6, 24);
  expect(
    calendarQuantity(stored.data, adjustmentDay, adjustmentDay).rows.find(
      (r) => r.materialId === 'book',
    ),
  ).toMatchObject({
    reported: true,
    actual: 0,
  });
  expect(stored.data.records.find((r) => r.id === 'explicit-zero')).toMatchObject({
    count: 0,
    cancelled: false,
  });
  stored = await save(
    request,
    stored,
    recordAndAdjust(stored.data, adjustmentReport(4, 'desktop-partial'), adjustmentContext),
    'direct',
  );
  quantities(stored.data, adjustmentDay, 4, 2, 24);
  expect(stored.data.plan!.sessions.find((s) => s.id === fixed.id)).toEqual(fixed);
  const beforeOverrun = structuredClone(stored.data.plan);
  stored = await save(
    request,
    stored,
    recordAndAdjust(stored.data, adjustmentReport(4, 'desktop-overrun'), adjustmentContext),
    'direct',
  );
  // Existing desktop policy stops rather than consuming a protected future slot.
  // This is explicitly unreflected work, never a successfully balanced allocation.
  expect(currentProgressAdjustment(stored.data)).toMatchObject({
    status: 'failed',
    detail: expect.stringContaining('固定予定'),
  });
  expect(stored.data.plan).toEqual(beforeOverrun);
  expect(stored.data.plan!.sessions.find((s) => s.id === fixed.id)).toEqual(fixed);
  expect(remainingWork(stored.data, adjustmentDay)[0]).toMatchObject({
    total: 30,
    completed: 8,
    remaining: 22,
    allocated: 24,
    unplaced: 0,
    balanced: false,
  });
  expect(stored.data.records.map((r) => r.count)).toEqual([0, 4, 4]);
  expect(
    (await http<Envelope>(request, 'load_state')).data.records.find(
      (r) => r.id === 'explicit-zero',
    ),
  ).toMatchObject({ count: 0, cancelled: false });
});

test('LANで保存した計画案はDesktopで実績更新後に承認できず、記録と固定予定を保護する', async ({
  request,
}) => {
  const fixture = restartFixture();
  fixture.plan!.sessions[0].fixed = true;
  const fixed = structuredClone(fixture.plan!.sessions[0]);
  let stored = await seed(fixture);
  stored = await save(
    request,
    stored,
    proposeRestart(stored.data, addDays(adjustmentDay, 1), adjustmentContext),
  );
  quantities(stored.data, adjustmentDay, 4, 0, 20, 6);
  expect(stored.data.proposal!.plan.conflicts).toEqual([]);
  expect(stored.data.proposal!.plan.sessions.find((s) => s.id === fixed.id)).toEqual(fixed);
  expect(() => approve(stored.data, false, adjustmentContext)).not.toThrow();
  const originalProposal = structuredClone(stored.data.proposal);

  stored = await save(
    request,
    stored,
    recordAndAdjust(stored.data, adjustmentReport(1, 'desktop-after-proposal'), adjustmentContext),
    'direct',
  );
  const loaded = await http<Envelope>(request, 'load_state');
  expect(currentProgressAdjustment(loaded.data)?.status).toBe('review');
  expect(loaded.data.proposal).toEqual(originalProposal);
  expect(loaded.data.records.map((r) => r.count)).toEqual([2, 1]);
  expect(remainingWork(loaded.data, adjustmentDay)[0]).toMatchObject({
    completed: 5,
    remaining: 25,
  });
  const beforeReject = structuredClone(loaded.data);
  expect(() => approve(loaded.data, false, adjustmentContext)).toThrow(
    '案の作成後に基準日・計画・設定・実績が変わりました',
  );
  expect(loaded.data).toEqual(beforeReject);
  expect(loaded.data.plan!.sessions.find((s) => s.id === fixed.id)).toEqual(fixed);
  expect(await direct<Envelope>('load_state')).toEqual(stored);
});
