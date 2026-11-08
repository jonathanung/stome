import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { Button, useStoneTheme } from '../../../design-theme/src/primitives';
import type { StudyQuestion } from '../../data/models';
import { Field, Notice } from '../../ui/kit';
import { checkAnswer } from './session';

export type QuizAnswers = { questionId: string; input: string; correct: boolean }[];

/**
 * Quiz runner: one question at a time, feedback + explanation per question,
 * never advances on an unanswered question. Presentational only; the screen
 * commits review.marks on finish. Cancel writes nothing.
 */
export function SessionQuiz({
  questions,
  staleByQuestion,
  onFinish,
  onCancel,
}: {
  questions: StudyQuestion[];
  staleByQuestion: boolean[];
  onFinish: (answers: QuizAnswers) => void;
  onCancel: () => void;
}) {
  const theme = useStoneTheme();
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [choice, setChoice] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ correct: boolean } | null>(null);
  const [answers, setAnswers] = useState<QuizAnswers>([]);
  const [error, setError] = useState<string | null>(null);

  const total = questions.length;
  const question = questions[index] ?? null;
  const stale = staleByQuestion[index] ?? false;
  const currentInput = question?.kind === 'mcq' ? (choice ?? '') : input;
  const answered = currentInput.trim().length > 0;

  function resetAnswer() {
    setInput('');
    setChoice(null);
    setChecked(null);
    setError(null);
  }

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const host = globalThis as unknown as { document?: Document };
    if (!host.document) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      const target = event.target as { tagName?: string } | null;
      if (target && /TEXTAREA/.test(target.tagName ?? '')) return;
      if (!question || checked) return;
      if (!answered) return;
      event.preventDefault();
      setChecked(checkAnswer(question, currentInput));
    };
    host.document.addEventListener('keydown', onKey);
    return () => host.document?.removeEventListener('keydown', onKey);
  }, [question, checked, answered, currentInput]);

  if (!question) {
    return (
      <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>
        No questions in this quiz yet.
      </Text>
    );
  }

  function check() {
    if (!answered) {
      setError('Answer first — the runner never advances on an unanswered question.');
      return;
    }
    setError(null);
    setChecked(checkAnswer(question!, currentInput));
  }

  function next() {
    if (!checked) {
      setError('Check your answer first — the runner never advances on an unanswered question.');
      return;
    }
    const entry = { questionId: question!.id, input: currentInput, correct: checked.correct };
    const nextAnswers = [...answers, entry];
    if (index + 1 >= total) {
      onFinish(nextAnswers);
      return;
    }
    setAnswers(nextAnswers);
    setIndex(index + 1);
    resetAnswer();
  }

  return (
    <View style={{ gap: theme.space.base }} testID="study-quiz-runner">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text testID="study-quiz-progress" style={[theme.text('caption'), { color: theme.color.text.tertiary, fontVariant: ['tabular-nums'] }]}>
          {`Question ${Math.min(index + 1, total)} of ${total}`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel quiz run"
          accessibilityHint="Cancel saves nothing"
          onPress={onCancel}
          testID="study-quiz-cancel"
          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[theme.text('nav'), { color: theme.color.text.secondary }]}>Cancel</Text>
        </Pressable>
      </View>

      {stale ? (
        <Notice tone="warning" testID="study-quiz-stale">
          Source changed — this question may be outdated. It does not claim the current note is verified.
        </Notice>
      ) : null}
      {error ? <Notice tone="danger" testID="study-quiz-error">{error}</Notice> : null}

      <View
        style={{
          backgroundColor: theme.color.bg.surface,
          borderColor: theme.color.border.hairline,
          borderWidth: 1,
          borderRadius: theme.radius.card,
          paddingHorizontal: theme.space.card,
          paddingVertical: 20,
          gap: theme.space.md,
          ...theme.shadow.card,
        }}
      >
        <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>
          {question.kind === 'mcq' ? 'Multiple choice' : question.kind === 'true_false' ? 'True / false' : 'Fill in the blank'}
        </Text>
        <Text testID="study-quiz-stem" accessibilityRole="header" style={[theme.text('actionTitle'), { color: theme.color.text.primary, fontSize: 20, lineHeight: 27 }]}>
          {question.stem}
        </Text>

        {question.kind === 'mcq' ? (
          <View style={{ gap: theme.space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Answer choices">
            {question.choices.map((option) => {
              const selected = choice === option;
              const dimmed = checked && !selected && option !== question.answer && checked.correct === false ? 0.7 : 1;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={option}
                  disabled={checked !== null}
                  onPress={() => setChoice(option)}
                  testID={`study-quiz-choice-${option.slice(0, 24)}`}
                  style={{
                    minHeight: 48,
                    borderRadius: theme.radius.control,
                    borderWidth: selected ? 2 : 1,
                    borderColor: checked && option === question.answer ? theme.color.status.success.fill : selected ? theme.color.text.primary : theme.color.border.strong,
                    backgroundColor: checked && option === question.answer ? theme.color.status.success.wash : theme.color.bg.canvas,
                    paddingHorizontal: theme.space.xl,
                    paddingVertical: theme.space.lg,
                    justifyContent: 'center',
                    opacity: dimmed,
                  }}
                >
                  <Text style={[theme.text('body'), { color: theme.color.text.primary }]}>{option}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : question.kind === 'true_false' ? (
          <View style={{ flexDirection: 'row', gap: theme.space.md }}>
            {['true', 'false'].map((option) => (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ checked: choice === option }}
                accessibilityLabel={option}
                disabled={checked !== null}
                onPress={() => setChoice(option)}
                testID={`study-quiz-tf-${option}`}
                style={{
                  flex: 1,
                  minHeight: 52,
                  borderRadius: theme.radius.control,
                  borderWidth: choice === option ? 2 : 1,
                  borderColor: choice === option ? theme.color.text.primary : theme.color.border.strong,
                  backgroundColor: theme.color.bg.canvas,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={[theme.text('buttonCompact'), { color: theme.color.text.primary }]}>
                  {option === 'true' ? 'True' : 'False'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Field
            accessibilityLabel="Your answer"
            placeholder="Type your answer"
            value={input}
            onChangeText={setInput}
            editable={checked === null}
            testID="study-quiz-fill"
          />
        )}

        {checked ? (
          <Notice tone={checked.correct ? 'success' : 'danger'} testID="study-quiz-feedback">
            {checked.correct ? 'Correct. ' : `Not quite — the answer is ${question.answer}. `}
            {question.explanation ? question.explanation : ''}
          </Notice>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: theme.space.md }}>
        {!checked ? (
          <View style={{ flex: 1 }}>
            <Button label="Check answer" onPress={check} disabled={!answered} />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <Button label={index + 1 >= total ? 'Finish run' : 'Next question'} onPress={next} />
          </View>
        )}
      </View>
      <Text style={[theme.text('caption'), { color: theme.color.text.tertiary, textAlign: 'center' }]}>
        Cancel saves nothing. Finishing marks each source note.
      </Text>
    </View>
  );
}
