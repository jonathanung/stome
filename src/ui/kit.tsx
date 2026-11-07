import { Children, isValidElement, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { useStoneTheme } from '../../design-theme/src/primitives';
import { Icon, type IconName } from './Icon';

/** One reading column, centred on wide screens. */
export function useColumn(): ViewStyle {
  const theme = useStoneTheme();
  return {
    width: '100%',
    maxWidth: theme.layout.paperMax,
    alignSelf: 'center',
    paddingHorizontal: theme.space.card,
  };
}

export function BackButton({
  label,
  onPress,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const theme = useStoneTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={8}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.xxs,
        minHeight: theme.layout.control,
        marginLeft: -theme.space.sm,
        paddingRight: theme.space.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name="chevronLeft" size={20} color={theme.color.text.secondary} />
      <Text style={[theme.text('nav'), { color: theme.color.text.secondary }]}>{label}</Text>
    </Pressable>
  );
}

/** Kicker line, screen title, and at most one action on the right. */
export function ScreenHeader({
  kicker,
  title,
  back,
  action,
  children,
}: {
  kicker?: string;
  title: string;
  back?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const theme = useStoneTheme();
  return (
    <View style={{ gap: theme.space.xs, paddingTop: back ? 0 : theme.space.base }}>
      {back}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space.xl }}>
        <View style={{ flex: 1, gap: theme.space.xs }}>
          {kicker ? <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{kicker}</Text> : null}
          <Text accessibilityRole="header" style={[theme.text('screenTitle'), { color: theme.color.text.primary }]}>
            {title}
          </Text>
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

export function SectionTitle({ children, aside }: { children: string; aside?: ReactNode }) {
  const theme = useStoneTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space.xl }}>
      <Text accessibilityRole="header" style={[theme.text('title'), { color: theme.color.text.primary }]}>{children}</Text>
      {aside}
    </View>
  );
}

/** Round 44pt button. `accent` is the one primary action on a screen. */
export function RoundAction({
  icon,
  label,
  onPress,
  variant = 'accent',
  disabled = false,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  variant?: 'accent' | 'quiet';
  disabled?: boolean;
  testID?: string;
}) {
  const theme = useStoneTheme();
  const accent = variant === 'accent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        width: theme.layout.control,
        height: theme.layout.control,
        borderRadius: theme.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: accent ? theme.color.accent.bg : theme.color.bg.surface,
        borderWidth: accent ? 0 : 1,
        borderColor: theme.color.border.hairline,
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        ...(accent ? {} : theme.shadow.card),
      })}
    >
      <Icon name={icon} size={20} strokeWidth={2} color={accent ? theme.color.accent.fg : theme.color.text.primary} />
    </Pressable>
  );
}

/** Rows that belong together share one rounded surface, split by hairlines. */
export function Group({ children, testID }: { children: ReactNode; testID?: string }) {
  const theme = useStoneTheme();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: theme.color.bg.surface,
        borderRadius: theme.radius.float,
        borderWidth: 1,
        borderColor: theme.color.border.hairline,
        overflow: 'hidden',
        ...theme.shadow.card,
      }}
    >
      {items.map((child, index) => (
        <View
          key={child.key ?? index}
          style={index === 0 ? undefined : { borderTopWidth: 1, borderTopColor: theme.color.border.hairline }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  accessibilityLabel,
  accessibilityRole = 'button',
  chevron = true,
  testID,
}: {
  chevron?: boolean;
  title: string;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link';
  testID?: string;
}) {
  const theme = useStoneTheme();
  const body = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0, gap: theme.space.xxs }}>
        <Text numberOfLines={1} style={[theme.text('button'), { color: theme.color.text.primary }]}>{title}</Text>
        {typeof subtitle === 'string'
          ? <Text numberOfLines={2} style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>{subtitle}</Text>
          : subtitle}
      </View>
      {trailing ?? (onPress && chevron ? <Icon name="chevronRight" size={18} color={theme.color.text.tertiary} /> : null)}
    </>
  );
  const frame: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.xl,
    minHeight: 64,
    paddingVertical: theme.space.lg,
    paddingHorizontal: theme.space.base,
  };
  if (!onPress) return <View style={frame} testID={testID}>{body}</View>;
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [frame, pressed ? { backgroundColor: theme.color.bg.alt } : null]}
    >
      {body}
    </Pressable>
  );
}

/** Inset text field. The edge darkens while it has focus. */
export function Field({ style, multiline, onFocus, onBlur, ref, ...props }: TextInputProps & { ref?: Ref<ComponentRef<typeof TextInput>> }) {
  const theme = useStoneTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={theme.color.text.tertiary}
      multiline={multiline}
      textAlignVertical={multiline ? 'top' : 'center'}
      onFocus={(event) => { setFocused(true); onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); onBlur?.(event); }}
      {...props}
      ref={ref}
      style={[
        theme.text('body'),
        {
          minHeight: theme.layout.control,
          minWidth: 0,
          paddingHorizontal: theme.space.xl,
          paddingVertical: theme.space.lg,
          borderRadius: theme.radius.control,
          borderWidth: 1,
          borderColor: focused ? theme.color.border.strong : 'transparent',
          backgroundColor: theme.color.bg.inset,
          color: theme.color.text.primary,
        },
        style,
      ]}
    />
  );
}

type NoticeTone = 'danger' | 'warning' | 'success' | 'neutral';

/** An inline status line on its wash. Danger and warning are announced. */
export function Notice({ tone, children, testID }: { tone: NoticeTone; children: ReactNode; testID?: string }) {
  const theme = useStoneTheme();
  const pair = tone === 'neutral'
    ? { wash: theme.color.bg.alt, text: theme.color.text.secondary }
    : { wash: theme.color.status[tone].wash, text: theme.color.status[tone].text };
  const announce = tone === 'danger' || tone === 'warning';
  return (
    <View style={{ backgroundColor: pair.wash, borderRadius: theme.radius.control, paddingHorizontal: theme.space.xl, paddingVertical: theme.space.lg }}>
      <Text accessibilityRole={announce ? 'alert' : undefined} testID={testID} style={[theme.text('bodySmall'), { color: pair.text }]}>
        {children}
      </Text>
    </View>
  );
}

/** An empty state that says what to do next. */
export function EmptyState({ title, body, children, testID }: { title: string; body?: string; children?: ReactNode; testID?: string }) {
  const theme = useStoneTheme();
  return (
    <View
      testID={testID}
      style={{
        alignItems: 'flex-start',
        gap: theme.space.md,
        padding: theme.space.card,
        borderRadius: theme.radius.float,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.color.border.strong,
      }}
    >
      <Text style={[theme.text('cardTitle'), { color: theme.color.text.primary }]}>{title}</Text>
      {body ? <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>{body}</Text> : null}
      {children ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md, marginTop: theme.space.xs }}>{children}</View> : null}
    </View>
  );
}
