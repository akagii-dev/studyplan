import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  DatabaseBackup,
  RefreshCw,
  Timer,
} from 'lucide-react';

type Destination =
  | 'dashboard'
  | 'future'
  | 'setup'
  | 'availability'
  | 'focus'
  | 'calendar'
  | 'today'
  | 'progress'
  | 'history'
  | 'report'
  | 'replan'
  | 'backup';
const lessons = [
  {
    name: 'はじめの設定',
    icon: BookOpen,
    title: '質問に答えて、計画の準備',
    flow: ['試験・目標', '時間・授業', '教材'],
    points: [
      [
        '一問ずつ入力',
        '途中の回答も自動保存します。数値は空欄にして書き直せます。入力後はEnterか「次へ」で進みます。',
      ],
      [
        'あとから修正',
        '初期設定の「設定項目を選んで修正する」から戻れます。「あとで」を選ぶと、未設定による影響を表示します。',
      ],
      ['教材の時間', '1問の推定時間は周回ごとに指定できます。同じ値でもかまいません。'],
      [
        '試験・教材の追加',
        '設定の「試験・目標」「教材」から登録できます。計画案の承認後に予定へ反映されます。',
      ],
    ],
    actions: [{ page: 'setup', label: '初期設定へ' }],
  },
  {
    name: '勉強できる時間',
    icon: Timer,
    title: '空き時間の中に、休憩と余裕を',
    flow: ['勉強 50分', '休憩 10分', '勉強 50分'],
    points: [
      [
        '開始・終了の意味',
        '学習可能枠は「予定を入れてよい時間帯」です。そこから授業・食事・予定を除きます。時間割は期間ごとに設定できます。',
      ],
      [
        '連続時間と休憩',
        '例のように、最長の連続時間に達したら休憩を挟みます。授業前後の移動時間も設定できます。',
      ],
      [
        '余裕率',
        '月〜日で合計した学習可能量に適用します。週30時間・20%なら予定は最大24時間です。残り6時間を曜日に予約しません。20%は変更できる初期値です。',
      ],
    ],
    actions: [
      { page: 'availability', label: '時間枠・時間割へ' },
      { page: 'focus', label: '連続時間・余裕率へ' },
    ],
  },
  {
    name: '計画を見る',
    icon: CalendarDays,
    title: '今日と今後の予定',
    flow: ['計画案を作成', '承認', '今日の予定'],
    points: [
      [
        '予定の時刻',
        'カードは勉強の開始・終了予定です。授業も表示します。食事は空き時間の計算に含め、予定カードには出しません。',
      ],
      [
        'まとまった学習',
        '問題数ではなく推定時間でまとめます。初期値は下限10分・目安30分。論文2問で60分なら通常の予定です。短い端数は統合を試み、完了時や期限上必要な場合だけ例外にします。',
      ],
      [
        '計画の条件',
        '使用した設定の日時と一日の問題数を確認できます。余裕率0%の終了日は参考値で、未報告分を含み、別枠の復習は除きます。最短日の保証ではありません。',
      ],
      [
        'ICSで書き出す',
        '今後の予定から詳細カレンダーを開き、期間と予定の種類を選べます。書き出したファイルは自動更新されません。',
      ],
    ],
    actions: [
      { page: 'dashboard', label: '今日へ' },
      { page: 'future', label: '今後の予定へ' },
      { page: 'today', label: '今日の時間内訳へ' },
    ],
  },
  {
    name: '進捗を記録',
    icon: CheckCircle2,
    title: '今日の予定からそのまま記録',
    flow: ['今日の予定', '追加問数', '記録'],
    points: [
      [
        '累計ではなく追加分',
        '今日の問題集・周回の行に、今回解いた問数を入力します。予定外の学習も同じ画面から記録できます。',
      ],
      [
        '0問と未報告',
        '0問は「今日は0問」の記録です。以前の完了数は消えません。記録していない日は未報告のままです。',
      ],
      [
        '間違えたとき',
        '記録履歴で訂正・取消できます。残量を計算し直し、明日以降へ自動で配分します。',
      ],
      [
        '週間レポート',
        '対象の週を選ぶと、週の記録と出力時点の全体進捗を比較し、Markdownファイルへ保存できます。未報告と0問は区別します。過去週の全体進捗も出力時点の値です。',
      ],
    ],
    actions: [
      { page: 'dashboard', label: '今日へ' },
      { page: 'history', label: '記録履歴へ' },
      { page: 'progress', label: '過去日の記録へ' },
      { page: 'report', label: '週間レポートへ' },
    ],
  },
  {
    name: '計画を見直す',
    icon: RefreshCw,
    title: 'いまの設定を引き継いで、組み直す',
    flow: ['対話で修正', '変更案を比較', '承認'],
    points: [
      [
        '変えたい項目だけ',
        '現在の設定から始め、目標日・授業・教材などを一問ずつ修正します。承認するまでは元の計画を使います。',
      ],
      [
        '固定と未報告',
        '日々の記録は明日以降を自動調整します。固定予定や未承認の設定案がある場合は、記録を保持して計画の確認へ進めます。未報告を0問にはしません。',
      ],
      ['戻すとき', '承認前の計画へ戻せます。進捗記録は巻き戻しません。'],
    ],
    actions: [{ page: 'replan', label: '再計画の確認へ' }],
  },
  {
    name: '保存と復元',
    icon: DatabaseBackup,
    title: '大切な記録を、ファイルにも保存',
    flow: ['バックアップを保存', '内容を確認', '復元'],
    points: [
      [
        '普段は自動保存',
        '設定・計画・実績はこの端末のSQLiteに保存します。終了時も保存が終わるまで待ちます。',
      ],
      [
        'バックアップの内容',
        '入力途中・固定予定・取消済み記録・計画履歴・未承認案・初期化前の控え・配色も含みます。内部の監査履歴は含みません。ファイルは暗号化されません。',
      ],
      [
        '復元は全体の置き換え',
        '設定・計画に加え、進捗記録も置き換わります。直前の状態へ1回分戻せます。',
      ],
    ],
    actions: [{ page: 'backup', label: 'バックアップへ' }],
  },
] satisfies {
  name: string;
  icon: typeof BookOpen;
  title: string;
  flow: string[];
  points: string[][];
  actions: { page: Destination; label: string }[];
}[];

export function Tutorial({ navigate, step, onStepChange, onClose }: { navigate: (page: Destination) => void; step: number; onStepChange: (step: number) => void; onClose: () => void }) {
  const setStep = onStepChange;
  const lesson = lessons[step];
  return (
    <div className="tutorial">
      <nav className="tutorial-topics" aria-label="チュートリアルの項目">
        {lessons.map((item, i) => (
          <button key={item.name} aria-pressed={step === i} onClick={() => setStep(i)}>
            <item.icon size={18} />
            <span>{item.name}</span>
          </button>
        ))}
      </nav>
      <section className="card tutorial-lesson" aria-labelledby="tutorial-title">
        <div className="eyebrow">
          {step + 1} / {lessons.length}
        </div>
        <h2 id="tutorial-title">{lesson.title}</h2>
        <div className="tutorial-flow" aria-label="操作・設定の例">
          {lesson.flow.map((item, i) => (
            <span key={item + i}>
              {i > 0 && <ArrowRight size={16} aria-hidden="true" />}
              <b>{item}</b>
            </span>
          ))}
        </div>
        <dl className="tutorial-points">
          {lesson.points.map(([title, text]) => (
            <div key={title}>
              <dt>{title}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <div className="actions">
          {lesson.actions.map((action, i) => (
            <button
              key={action.page}
              className={i === 0 ? 'primary' : ''}
              onClick={() => navigate(action.page)}
            >
              {action.label}
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
        <div className="question-footer tutorial-footer">
          <button disabled={step === 0} onClick={() => setStep(step - 1)}>
            前の項目
          </button>
          <button onClick={() => step === lessons.length - 1 ? onClose() : setStep(step + 1)}>
            {step === lessons.length - 1 ? '終了して戻る' : '次の項目'}
          </button>
        </div>
      </section>
    </div>
  );
}
