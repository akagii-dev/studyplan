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
