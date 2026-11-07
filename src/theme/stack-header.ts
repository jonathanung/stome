/** Header colors that follow the active scheme instead of a fixed parchment bar. */
export interface StackHeaderTheme {
  color: {
    bg: { canvas: string };
    text: { primary: string };
  };
}

export function stackHeaderOptions(theme: StackHeaderTheme) {
  return {
    headerTitle: 'stome',
    headerStyle: { backgroundColor: theme.color.bg.canvas },
    headerTintColor: theme.color.text.primary,
  };
}
