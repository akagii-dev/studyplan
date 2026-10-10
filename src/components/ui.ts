/**
 * Utility lists for patterns that several screens share. The plain class names
 * (`choices`, `wizard-options`, `question-card`, …) stay as hooks for screen context and tests.
 */

/** A row of option buttons. */
export const choices = 'choices flex flex-wrap gap-2 [&_button]:min-w-10';

/** Large option buttons, such as the buffer percentages. */
export const choicesLarge =
  'choices large my-[22px] flex flex-wrap gap-2 [&_button]:min-h-20 [&_button]:min-w-[95px] [&_button]:flex-col [&_button]:text-[20px] [&_small]:text-[10px]';

/** A vertical list of answer buttons in the guided questions. */
export const wizardOptions =
  'wizard-options flex flex-col gap-3 [&>button]:min-h-[54px] [&>button]:justify-start [&>button]:px-5 [&>button]:py-4 [&>button]:text-[14px] [&>button.primary]:justify-center';

/** The box that repeats the answers before they are saved. */
export const answerSummary =
  'mb-[22px] rounded-[9px] border border-line bg-soft px-6 py-[21px] [&_.row]:px-0 [&_.row]:py-[9px] [&_.row]:text-[13px] [&_h3]:text-[17px] [&_input]:max-w-[155px] [&_input]:p-[7px] [&_p]:mx-0 [&_p]:my-2 [&_p]:text-[13px]';

/** One guided question: title, answer and footer stacked to fill the card. */
export const questionCard =
  'question-card flex min-h-[385px] flex-col [&_h2]:mx-0 [&_h2]:mt-[13px] [&_h2]:mb-2.5 [&_h2]:text-[25px] [&_h2]:leading-[1.7] max-[1000px]:[&_h2]:text-[22px]';

/** Back and next buttons under a question; the back button is a quiet text button. */
export const questionFooter =
  'question-footer mt-auto flex justify-between border-t border-t-line pt-[22px] [&>button:first-child]:pl-0 [&>button:first-child:enabled]:border-transparent [&>button:first-child:enabled]:bg-transparent [&>button:first-child:enabled]:text-muted';

/** Two columns, the second narrower; one column in a narrow container. */
export const split =
  'split grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-[26px] [align-items:start] max-[1150px]:gap-[18px] @max-[680px]:grid-cols-[minmax(0,1fr)]';

/** A small count or kind label. */
export const badge = 'badge rounded-[4px] bg-soft px-[7px] py-[3px] text-[10px] text-muted';

/** A checkbox with its label on one line. */
export const check = 'check flex items-center gap-2.5 text-[12px]';

/** Inline confirmation before deleting: question and buttons. */
export const deleteConfirm = 'flex flex-wrap items-center gap-1.5 [&_span]:text-[12px]';

/** A borderless icon-only edit button that still shows the hover state. */
export const iconButton = 'p-1.5 enabled:border-transparent enabled:bg-transparent hover:enabled:border-accent hover:enabled:bg-soft';

/** A borderless button in the period navigation (previous, next, today, settings). */
export const periodButton =
  'min-h-11 min-w-11 border-0 bg-transparent text-accent hover:enabled:bg-soft active:enabled:bg-accent active:enabled:text-surface';

/** A checkbox that confirms a replacing action, with its statement on one line. */
export const confirmCheck = 'my-4 flex items-center gap-2.5 [&_input]:w-auto';

/** Registration status text; `statusBox` adds the frame when it is not inside a card. */
export const statusText = 'mb-[1.4rem] [&_h3]:mt-0 [&_p]:mx-0 [&_p]:mt-[0.65rem] [&_p]:mb-[1rem]';
export const statusBox = `rounded-[16px] border border-line bg-surface p-[1.2rem] ${statusText}`;

/** The weekly class timetable: heading row, period labels and day buttons. */
export const timetableGrid =
  'timetable mx-0 mt-[15px] mb-[25px] grid items-center text-center @max-[680px]:overflow-x-auto [&>b]:text-[12px] [&>b]:font-normal [&>div:first-child]:text-[11px] [&>div:first-child]:text-muted';
export const timetableRow =
  'timetable-row contents [&>button]:h-[45px] [&>button]:bg-surface [&>button]:text-muted [&>button.class-selected]:border-2 [&>button.class-selected]:border-[var(--busy-border)] [&>button.class-selected]:bg-[var(--busy-bg)] [&>button.class-selected]:text-[var(--busy-ink)] [&>button.class-selected_small]:block [&>button.class-selected_small]:text-[10px] [&>button.class-selected_small]:text-[var(--busy-muted)] [&>button:hover:enabled]:border-accent [&>button:hover:enabled]:bg-soft [&>label]:flex [&>label]:items-center [&>label]:gap-2 [&>label]:text-[11px] [&>label]:whitespace-nowrap [&>label_input]:px-1.5 [&>label_input]:py-[7px]';
