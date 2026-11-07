import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, Text, TextInput, View, useColorScheme } from "react-native";
import { createTheme, type StoneTheme } from "./theme";
import { dayTileRadius, type ColorScheme, type TypeRole } from "./tokens";

const StoneContext = createContext<StoneTheme>(createTheme("light"));

/**
 * Default scheme follows the device. Pass "light" or "dark" to lock overcast
 * or dusk. fontMode "expo" expects the weight-specific family names from
 * @expo-google-fonts (see tokens.expoFontFamilies) and leaves numeric
 * fontWeight at "normal" so Android does not synthesize a second bold.
 */
export function ThemeProvider({
  scheme = "system",
  fontMode = "css",
  children,
}: {
  scheme?: ColorScheme | "system";
  fontMode?: "css" | "expo";
  children: ReactNode;
}) {
  const system = useColorScheme();
  const resolved: ColorScheme =
    scheme === "light" || scheme === "dark" ? scheme : system === "dark" ? "dark" : "light";
  const theme = useMemo(() => createTheme(resolved, fontMode), [resolved, fontMode]);
  return <StoneContext.Provider value={theme}>{children}</StoneContext.Provider>;
}

export function useStoneTheme(): StoneTheme {
  return useContext(StoneContext);
}

/** Module-level hook factory. Call the result during render, the way `useStyles` is called. */
export function createStyles<T>(factory: (theme: StoneTheme) => T): () => T {
  return function useStyles(): T {
    const theme = useStoneTheme();
    return useMemo(() => factory(theme), [theme]);
  };
}

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduce(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

type Tone =
  | "primary"
  | "secondary"
  | "tertiary"
  | "disabled"
  | "onFill"
  | "accent"
  | "success"
  | "warning"
  | "danger";

function toneColor(theme: StoneTheme, tone: Tone): string {
  switch (tone) {
    case "primary":
      return theme.color.text.primary;
    case "secondary":
      return theme.color.text.secondary;
    case "tertiary":
      return theme.color.text.tertiary;
    case "disabled":
      return theme.color.text.disabled;
    case "onFill":
      return theme.color.text.onFill;
    case "accent":
      return theme.color.accent.fg;
    case "success":
      return theme.color.status.success.text;
    case "warning":
      return theme.color.status.warning.text;
    case "danger":
      return theme.color.status.danger.text;
  }
}

export function Screen({ children }: { children: ReactNode }) {
  const theme = useStoneTheme();
  return <View style={{ flex: 1, backgroundColor: theme.color.bg.canvas }}>{children}</View>;
}

export function Surface({
  variant = "surface",
  children,
  padded = false,
}: {
  variant?: "canvas" | "surface" | "alt" | "inset" | "inverse";
  children?: ReactNode;
  padded?: boolean;
}) {
  const theme = useStoneTheme();
  const backgroundColor = {
    canvas: theme.color.bg.canvas,
    surface: theme.color.bg.surface,
    alt: theme.color.bg.alt,
    inset: theme.color.bg.inset,
    inverse: theme.color.bg.inverse,
  }[variant];
  return (
    <View
      style={{
        backgroundColor,
        padding: padded ? theme.space.card : 0,
      }}
    >
      {children}
    </View>
  );
}

export function StoneText({
  role = "body",
  tone = "primary",
  children,
}: {
  role?: TypeRole;
  tone?: Tone;
  children: ReactNode;
}) {
  const theme = useStoneTheme();
  return <Text style={[theme.text(role), { color: toneColor(theme, tone) }]}>{children}</Text>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <StoneText role="eyebrow" tone="tertiary">
      {children}
    </StoneText>
  );
}

export function Hairline() {
  const theme = useStoneTheme();
  return <View style={{ height: theme.space.hair, backgroundColor: theme.color.border.hairline }} />;
}

export function Card({ children }: { children: ReactNode }) {
  const theme = useStoneTheme();
  return (
    <View
      style={{
        backgroundColor: theme.color.bg.surface,
        borderRadius: theme.radius.card,
        borderWidth: 1,
        borderColor: theme.color.border.hairline,
        padding: theme.space.card,
        ...theme.shadow.card,
      }}
    >
      {children}
    </View>
  );
}

type ButtonVariant = "accent" | "outline" | "danger" | "ghost";

export function Button({
  label,
  variant = "accent",
  size = "regular",
  disabled = false,
  onPress,
}: {
  label: string;
  variant?: ButtonVariant;
  size?: "regular" | "compact" | "bar";
  disabled?: boolean;
  onPress?: () => void;
}) {
  const theme = useStoneTheme();
  const padX =
    size === "regular"
      ? theme.layout.buttonPadX
      : size === "compact"
        ? theme.layout.buttonCompactPadX
        : theme.layout.buttonBarPadX;
  const radius = size === "bar" ? theme.radius.control : theme.radius.lg;
  const role = size === "regular" ? "button" : "buttonCompact";
  const fill = disabled
    ? { backgroundColor: theme.color.bg.inset, borderColor: theme.color.bg.inset, color: theme.color.text.disabled }
    : variant === "accent"
      ? { backgroundColor: theme.color.accent.bg, borderColor: theme.color.accent.bg, color: theme.color.accent.fg }
      : variant === "danger"
        ? { backgroundColor: theme.color.status.danger.fill, borderColor: theme.color.status.danger.fill, color: theme.color.text.onFill }
        : variant === "outline"
          ? { backgroundColor: "transparent", borderColor: theme.color.border.strong, color: theme.color.text.primary }
          : { backgroundColor: "transparent", borderColor: "transparent", color: theme.color.text.primary };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: theme.layout.control,
        paddingHorizontal: padX,
        borderRadius: radius,
        borderWidth: 1,
        backgroundColor: fill.backgroundColor,
        borderColor: fill.borderColor,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={[theme.text(role), { color: fill.color }]}>{label}</Text>
    </Pressable>
  );
}

/** Glyph color for toolbar icons. React Native does not inherit CSS `currentColor`. */
export function iconColor(theme: StoneTheme, selected = false): string {
  return selected ? theme.color.accent.fg : theme.color.text.secondary;
}

export function IconButton({
  label,
  selected = false,
  onPress,
  children,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const theme = useStoneTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        width: theme.layout.control,
        height: theme.layout.control,
        borderRadius: theme.radius.control,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: selected ? theme.color.accent.bg : "transparent",
      }}
    >
      {children}
    </Pressable>
  );
}

type StatusTone = "success" | "warning" | "danger";

function statusPair(theme: StoneTheme, tone: StatusTone): { fill: string; text: string; wash: string } {
  if (tone === "success") {
    return { fill: theme.color.status.success.fill, text: theme.color.status.success.text, wash: theme.color.status.success.wash };
  }
  if (tone === "warning") {
    return { fill: theme.color.status.warning.fill, text: theme.color.status.warning.text, wash: theme.color.status.warning.wash };
  }
  return { fill: theme.color.status.danger.fill, text: theme.color.status.danger.text, wash: theme.color.status.danger.wash };
}

export function Badge({ tone, label }: { tone: StatusTone; label: string }) {
  const theme = useStoneTheme();
  const pair = statusPair(theme, tone);
  return (
    <View
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space.sm,
        paddingVertical: 2,
        paddingLeft: 8,
        paddingRight: 10,
        borderRadius: theme.radius.pill,
        backgroundColor: pair.wash,
      }}
    >
      <Text style={[theme.text("label"), { color: pair.text }]}>{label}</Text>
    </View>
  );
}

export function Chip({ label, onPress }: { label: string; onPress?: () => void }) {
  const theme = useStoneTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={{
        top: (theme.layout.control - theme.layout.chip) / 2,
        bottom: (theme.layout.control - theme.layout.chip) / 2,
      }}
      style={{
        minHeight: theme.layout.chip,
        paddingHorizontal: theme.space.xl,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.color.border.hairline,
        backgroundColor: theme.color.bg.surface,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={[theme.text("chip"), { color: theme.color.text.secondary }]}>{label}</Text>
    </Pressable>
  );
}

/** Signature day square. Radius is 2px for every 8px of size. */
export function DayTile({
  state,
  size,
}: {
  state: "done" | "atRisk" | "pending" | "empty";
  size?: number;
}) {
  const theme = useStoneTheme();
  const tile = size ?? theme.layout.habit;
  const base = {
    width: tile,
    height: tile,
    borderRadius: dayTileRadius(tile),
  };
  if (state === "done") return <View style={{ ...base, backgroundColor: theme.color.accent.bg }} />;
  if (state === "atRisk") {
    return (
      <View
        style={{
          ...base,
          backgroundColor: theme.color.status.warning.wash,
          borderWidth: 1.5,
          borderColor: theme.color.status.warning.fill,
        }}
      />
    );
  }
  if (state === "pending") return <View style={{ ...base, backgroundColor: theme.color.bg.inset }} />;
  return (
    <View
      style={{
        ...base,
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: theme.color.border.hairline,
      }}
    />
  );
}

export function HabitTile({ state }: { state: "done" | "atRisk" | "pending" | "empty" }) {
  return <DayTile state={state} />;
}

/** Trilithon mark. Fill follows accent so dusk inverts with the sheet. */
export function TrilithonMark({ width = 26, height = 18 }: { width?: number; height?: number }) {
  const theme = useStoneTheme();
  const sx = width / 72;
  const sy = height / 48;
  const color = theme.color.accent.bg;
  return (
    <View accessibilityLabel="trilithon mark" style={{ width, height }}>
      <View
        style={{
          position: "absolute",
          left: 4 * sx,
          top: 2 * sy,
          width: 64 * sx,
          height: 11 * sy,
          borderRadius: 2 * sx,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 9 * sx,
          top: 16 * sy,
          width: 16 * sx,
          height: 32 * sy,
          borderRadius: 2 * sx,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 47 * sx,
          top: 16 * sy,
          width: 16 * sx,
          height: 32 * sy,
          borderRadius: 2 * sx,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function NavRow({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const theme = useStoneTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: theme.layout.navItem,
        paddingHorizontal: theme.space.lg,
        borderRadius: theme.radius.control,
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space.lg,
        backgroundColor: selected ? theme.color.accent.bg : "transparent",
      }}
    >
      <Text
        style={[
          theme.text("nav"),
          { color: selected ? theme.color.accent.fg : theme.color.text.secondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function SearchField({ placeholder }: { placeholder: string }) {
  const theme = useStoneTheme();
  return (
    <View
      style={{
        minHeight: theme.layout.search,
        paddingHorizontal: theme.space.xl,
        borderRadius: theme.radius.control,
        backgroundColor: theme.color.bg.inset,
        justifyContent: "center",
      }}
    >
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={theme.color.text.tertiary}
        accessibilityLabel={placeholder}
        style={[theme.text("search"), { color: theme.color.text.primary, padding: 0 }]}
      />
    </View>
  );
}

export function AskComposer({
  placeholder,
  actionLabel = "ask",
  onSubmit,
}: {
  placeholder: string;
  actionLabel?: string;
  onSubmit?: () => void;
}) {
  const theme = useStoneTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space.xl,
        paddingLeft: theme.space.card,
        paddingRight: theme.space.md,
        paddingVertical: theme.space.md,
        borderRadius: theme.radius.card,
        backgroundColor: theme.color.bg.surface,
        borderWidth: 1,
        borderColor: theme.color.border.hairline,
        ...theme.shadow.card,
      }}
    >
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={theme.color.text.tertiary}
        accessibilityLabel={placeholder}
        style={[theme.text("body"), { flex: 1, minHeight: theme.layout.control, color: theme.color.text.primary, padding: 0 }]}
      />
      <Button label={actionLabel} size="compact" onPress={onSubmit} />
    </View>
  );
}

export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange?: (value: string) => void;
}) {
  const theme = useStoneTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        padding: 3,
        borderRadius: theme.radius.control,
        backgroundColor: theme.color.bg.inset,
      }}
    >
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange?.(option)}
            hitSlop={{
              top: (theme.layout.control - theme.layout.segment) / 2,
              bottom: (theme.layout.control - theme.layout.segment) / 2,
            }}
            style={{
              minHeight: theme.layout.segment,
              paddingHorizontal: theme.space.xl,
              borderRadius: theme.radius.md,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selected ? theme.color.bg.surface : "transparent",
              ...(selected ? theme.shadow.segment : null),
            }}
          >
            <Text
              style={[
                theme.text("chip"),
                { color: selected ? theme.color.text.primary : theme.color.text.secondary },
              ]}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Note highlight. The reference paints a wash and a 2px inset underline.
 * React Native text uses a bottom border for that underline.
 */
export function Highlight({
  tone = "lichen",
  children,
}: {
  tone?: "lichen" | "moss";
  children: ReactNode;
}) {
  const theme = useStoneTheme();
  const wash = tone === "lichen" ? theme.color.status.warning.wash : theme.color.status.success.wash;
  const line = tone === "lichen" ? theme.color.status.warning.fill : theme.color.status.success.fill;
  return (
    <Text
      style={{
        backgroundColor: wash,
        borderBottomWidth: 2,
        borderBottomColor: line,
        color: theme.color.text.primary,
      }}
    >
      {children}
    </Text>
  );
}

export function QuestionBubble({ children }: { children: ReactNode }) {
  const theme = useStoneTheme();
  return (
    <View
      style={{
        alignSelf: "flex-end",
        maxWidth: "85%",
        backgroundColor: theme.color.accent.bg,
        borderTopLeftRadius: theme.radius.bubble,
        borderTopRightRadius: theme.radius.bubble,
        borderBottomLeftRadius: theme.radius.bubble,
        borderBottomRightRadius: theme.radius.mark,
        paddingVertical: theme.space.lg,
        paddingHorizontal: theme.space.xxl,
      }}
    >
      <Text style={[theme.text("ask"), { color: theme.color.accent.fg }]}>{children}</Text>
    </View>
  );
}

export function AnswerBubble({ children }: { children: ReactNode }) {
  const theme = useStoneTheme();
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: theme.color.bg.canvas,
        borderTopLeftRadius: theme.radius.bubble,
        borderTopRightRadius: theme.radius.bubble,
        borderBottomRightRadius: theme.radius.bubble,
        borderBottomLeftRadius: theme.radius.mark,
        paddingVertical: theme.space.xxl,
        paddingHorizontal: theme.space.base,
      }}
    >
      <Text style={[theme.text("bodySmall"), { color: theme.color.text.primary }]}>{children}</Text>
    </View>
  );
}

export function StickyNote({
  tone = "lichen",
  children,
}: {
  tone?: "lichen" | "moss" | "surface";
  children: ReactNode;
}) {
  const theme = useStoneTheme();
  const backgroundColor =
    tone === "lichen"
      ? theme.color.status.warning.wash
      : tone === "moss"
        ? theme.color.status.success.wash
        : theme.color.bg.surface;
  return (
    <View
      style={{
        paddingVertical: theme.space.xxl,
        paddingHorizontal: theme.space.base,
        borderRadius: theme.radius.thumb,
        backgroundColor,
        ...theme.shadow.sticky,
      }}
    >
      <Text style={[theme.text("hand"), { color: theme.color.text.primary }]}>{children}</Text>
    </View>
  );
}

export function AnnotationNote({ children }: { children: ReactNode }) {
  const theme = useStoneTheme();
  return (
    <View
      style={{
        width: theme.layout.annotationNote,
        backgroundColor: theme.color.bg.surface,
        borderWidth: 1,
        borderColor: theme.color.border.hairline,
        borderRadius: theme.radius.float,
        padding: theme.space.base,
        gap: theme.space.lg,
        ...theme.shadow.float,
      }}
    >
      {children}
    </View>
  );
}

/** Deck slide. Paper colors stay chalk in dusk; they are not scheme tokens. */
export function SlideFrame({ children }: { children: ReactNode }) {
  const theme = useStoneTheme();
  return (
    <View
      style={{
        width: "100%",
        maxWidth: theme.layout.slideMax,
        aspectRatio: 16 / 9,
        backgroundColor: theme.paper.slide,
        borderRadius: theme.radius.md,
        paddingVertical: theme.layout.slidePadY,
        paddingHorizontal: theme.layout.slidePadX,
        ...theme.shadow.float,
      }}
    >
      {children}
    </View>
  );
}

/**
 * Grain is a blend mode plus an opacity in the reference (an SVG fractal
 * noise). Pass that noise as children. With no children this is only the
 * opacity layer, which does not invent a texture.
 */
export function Stack({
  direction = "column",
  gap,
  p,
  align,
  children,
}: {
  direction?: "row" | "column";
  gap?: keyof StoneTheme["space"];
  p?: keyof StoneTheme["space"];
  align?: "flex-start" | "center" | "flex-end" | "stretch";
  children?: ReactNode;
}) {
  const theme = useStoneTheme();
  return (
    <View
      style={{
        flexDirection: direction,
        gap: gap === undefined ? undefined : theme.space[gap],
        padding: p === undefined ? undefined : theme.space[p],
        alignItems: align,
      }}
    >
      {children}
    </View>
  );
}

export function GrainOverlay({ children }: { children?: ReactNode }) {
  const theme = useStoneTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        opacity: theme.grain.opacity,
      }}
    >
      {children}
    </View>
  );
}
