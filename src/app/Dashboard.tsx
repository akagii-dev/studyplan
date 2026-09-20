import { BookOpen, CalendarDays, CheckCircle2, ChevronRight, GraduationCap } from 'lucide-react';
import { AnimatedProgress } from '../components/AnimatedProgress';
import { Props, duration } from '../components/common';
import { DailyTime } from '../components/DailyTime';
import { Addition } from '../components/guided-setup';
import { Warning } from '../components/Warnings';
import { addDays, completed, remaining, today, weekday } from '../domain/model';
import { capacityForDate, datesBetween } from '../domain/planning';
import { todayProgress } from '../domain/todayProgress';
import { weeklyCapacities } from '../domain/weeklyCapacity';
import { Page } from './navigation';
export function Dashboard({
  state,
  navigate,
  generate,
  onAdd,
}: Props & { navigate: (p: Page) => void; generate: () => void; onAdd: (mode: Addition) => void }) {
  const s = state.settings;
  const daily = todayProgress(state);
  const required = s.materials.reduce(
    (n, m) => n + m.rounds.reduce((a, r, i) => a + remaining(state, m.id, i) * r.minutes, 0),
    0,
  );
  const week = addDays(today(), -((weekday(today()) + 6) % 7));
  const caps = (() => {
    try {
      return datesBetween(week, addDays(week, 6)).map((d) => capacityForDate(s, d));
    } catch {
      return null;
    }
  })();
  return (
    <>
      <div className="actions addition-actions">
        <button onClick={() => navigate('today')}>
          <CalendarDays size={17} />
          今日のスケジュール
        </button>
        <button className="primary" onClick={() => navigate(state.plan ? 'progress' : 'setup')}>
          {state.plan ? '今日の進捗を記録' : '質問に答えて計画をつくる'}
          <ChevronRight size={17} />
        </button>
        <button onClick={() => onAdd('addExam')}>
          <GraduationCap size={17} />
          試験を追加
        </button>
        <button onClick={() => onAdd('addMaterial')}>
          <BookOpen size={17} />
          教材を追加
        </button>
      </div>
      <div className="metrics">
        <div className="metric-card">
          <span>
            <GraduationCap size={17} />
            目指している試験
          </span>
          <strong>
            {s.exams.length}
            <small>つ</small>
          </strong>
        </div>
        <div className="metric-card">
          <span>
            <CheckCircle2 size={17} />
            今日の進捗
          </span>
          <strong>
            {daily.percent === null ? '—' : Math.round(daily.percent)}
            <small>%</small>
          </strong>
          <p>
            {daily.reported ? `今日の記録 ${daily.actual}問` : '今日は未報告'} · 予定{' '}
            {daily.planned}問
          </p>
          <AnimatedProgress label="今日の進捗" max={daily.planned} value={daily.matched} />
        </div>
        <div className="metric-card">
          <span>
            <BookOpen size={17} />
            残りの必要学習量
          </span>
          <strong className="smaller">{duration(required)}</strong>
          <p>周回ごとの残数 × 推定時間</p>
        </div>
      </div>
      <DailyTime settings={s} date={today()} />
      <div className="dashboard-grid">
        <section className="card">
          <div className="row">
            <h2>学習中の目標</h2>
            <button className="text-button" onClick={() => navigate('exams')}>
              目標を編集
              <ChevronRight size={14} />
            </button>
          </div>
          {!s.exams.length ? (
            <div className="empty">
              <GraduationCap size={28} />
              <h3>試験は未登録です</h3>
            </div>
          ) : (
            s.exams.map((e) => {
              const ms = s.materials.filter((m) => m.examId === e.id);
              const t = ms.reduce((n, m) => n + m.total * m.rounds.length, 0);
              const d = ms.reduce(
                (n, m) => n + m.rounds.reduce((a, _, i) => a + completed(state, m.id, i), 0),
                0,
              );
              return (
                <div className="goal-row" key={e.id}>
                  <i style={{ background: e.color }} />
                  <div>
                    <div className="row">
                      <h3>{e.name}</h3>
                      <b>{t ? Math.round((d / t) * 100) : 0}%</b>
                    </div>
                    <p>
                      目標 {e.target} · 教材 {ms.length}冊
                    </p>
                    <AnimatedProgress
                      label={`${e.name}の進捗`}
                      color={e.color}
                      value={d}
                      max={t || 1}
                    />
                  </div>
                </div>
              );
            })
          )}
          <div className="actions">
            <button onClick={() => navigate('calendar')}>
              カレンダーを見る
              <ChevronRight size={15} />
            </button>
            {s.exams.length > 0 && <button onClick={generate}>計画案を作成</button>}
          </div>
        </section>
        <section className="card week-summary">
          <div className="eyebrow">THIS WEEK</div>
          <h2>今週の学習時間</h2>
          <p>
            {week}〜{addDays(week, 6)}
          </p>
          {(['free', 'focus'] as const).map((k, i) => (
            <div className="capacity-row" key={k}>
              <span>{['① 空き枠', '② 学習可能量', '③ 計画割当可能量'][i]}</span>
              <b>{caps ? duration(caps.reduce((n, c) => n + c[k], 0)) : '設定を確認'}</b>
            </div>
          ))}
          <small>現在の設定から算出・授業と予定を除外済み</small>
          <div className="capacity-row">
            <span>週の割当上限</span>
            <b>{caps ? duration(weeklyCapacities(caps, s.buffer)[0]?.limit ?? 0) : '設定を確認'}</b>
          </div>
          <small>
            余裕率{Math.round(s.buffer * 100)}%は週全体に適用。日ごとの予約はありません。
          </small>
        </section>
      </div>
      {state.plan?.shortfalls.length ? (
        <Warning
          id="approved-shortfalls"
          title="未配置の課題があります"
          version={state.plan.shortfalls}
        >
          <b>
            未配置の課題があります：{state.plan.shortfalls.reduce((n, x) => n + x.count, 0)}問 /{' '}
            {duration(state.plan.shortfalls.reduce((n, x) => n + x.minutes, 0))}
          </b>
          <p>目標日や時間枠を見直し、再計画画面で不足を確認してください。</p>
        </Warning>
      ) : null}
    </>
  );
}
