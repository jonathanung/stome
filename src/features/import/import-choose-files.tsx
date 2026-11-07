import { Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { createStyles, useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon } from '../../ui/Icon';

export interface ChooseFileRow {
  id: string;
  /** Original file name as picked. */
  name: string;
  /** Editable source path used for dedup identity. */
  path: string;
  disabled?: boolean;
}

export type ImportStep = 1 | 2 | 3;

const STEPS = ['choose files', 'review chunks', 'pick rooms'] as const;

export function ImportSteps({ current }: { current: ImportStep }) {
  const styles = useStyles();
  return (
    <View accessibilityLabel="import steps" style={styles.steps}>
      {STEPS.map((label, i) => {
        const on = current === i + 1;
        return (
          <View key={label} style={styles.step}>
            <View style={[styles.stepNum, on && styles.stepNumOn]}><Text style={[styles.stepNumText, on && styles.stepNumTextOn]}>{i + 1}</Text></View>
            <Text style={[styles.stepLabel, on && styles.stepLabelOn]}>{label}</Text>
            {i < STEPS.length - 1 ? <Text style={styles.meta}>—</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

/** Source tiles: only Markdown is ready; the others are honest about their status. */
function Sources() {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const cols = width > 980 ? 4 : width > 640 ? 2 : 1;
  const items: { name: string; badge: string; tone: 'ok' | 'warn' | 'muted'; on: boolean; text: string }[] = [
    { name: 'markdown', badge: 'ready', tone: 'ok', on: true, text: 'obsidian notes or any .md file. headings, tags and properties come along.' },
    { name: 'pdf', badge: 'ready', tone: 'ok', on: true, text: 'goodnotes, onenote or any pdf. selectable text comes in one chunk per page; handwriting is not read.' },
    { name: 'onenote', badge: 'ready', tone: 'ok', on: true, text: 'html, mhtml or docx exports. notebook and section folders suggest subjects.' },
    { name: 'freeform', badge: 'ready', tone: 'ok', on: true, text: 'pdf exports bring their text. png or jpeg boards come in as a reference note; shapes are not read.' },
  ];
  return (
    <View style={styles.section} accessibilityLabel="source">
      <Text style={styles.eyebrow}>FROM</Text>
      <View style={styles.srcs}>
        {items.map((s) => (
          <View
            key={s.name}
            accessibilityRole={s.on ? 'button' : undefined}
            accessibilityState={s.on ? { selected: true } : { disabled: true }}
            style={[styles.src, { width: `${(100 - (cols - 1) * 1.5) / cols}%` }, s.on ? styles.srcOn : styles.srcOff]}
          >
            <View style={styles.srcHead}>
              <Text style={styles.srcName}>{s.name}</Text>
              <View style={[styles.badge, s.tone === 'ok' ? styles.badgeOk : s.tone === 'warn' ? styles.badgeWarn : styles.badgeMuted]}>
                <Text style={[styles.badgeText, s.tone === 'ok' ? styles.badgeOkText : s.tone === 'warn' ? styles.badgeWarnText : styles.badgeMutedText]}>{s.badge}</Text>
              </View>
            </View>
            <Text style={styles.meta}>{s.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ImportChooseFiles({
  collection, onCollection, rows, onPath, onRemove, onChoose, onCancel, onPreview, busy, onBack,
}: {
  collection: string;
  onCollection(value: string): void;
  rows: readonly ChooseFileRow[];
  onPath(id: string, path: string): void;
  onRemove(id: string): void;
  onChoose(): void;
  onCancel(): void;
  onPreview(): void;
  busy: boolean;
  onBack?: () => void;
}) {
  const styles = useStyles();
  const theme = useStoneTheme();
  const { width } = useWindowDimensions();
  const wide = width > 640;
  // Same file name without a folder in its path is ambiguous across a batch.
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  const ambiguous = (r: ChooseFileRow) => (counts.get(r.name) ?? 0) > 1 && !r.path.includes('/');
  const canPreview = rows.length > 0 && !busy;

  return (
    <View style={styles.stage}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Pressable accessibilityRole="link" onPress={onBack} hitSlop={8}><Text style={styles.meta}>← rooms</Text></Pressable>
          <Text accessibilityRole="header" style={styles.title}>bring your notes</Text>
          <Text style={styles.sub}>nothing is saved until you pick rooms and confirm. imports don&apos;t award stones.</Text>
        </View>
        <ImportSteps current={1} />
      </View>

      <Sources />

      <View style={styles.card} accessibilityLabel="files">
        <View style={[styles.collectionRow, wide && styles.collectionRowWide]}>
          <View style={[styles.field, wide && { flex: 1 }]}>
            <Text style={styles.eyebrow}>COLLECTION NAME</Text>
            <TextInput
              accessibilityLabel="Source collection" value={collection} onChangeText={onCollection} editable={!busy}
              autoCapitalize="none" autoCorrect={false} style={styles.input}
            />
          </View>
          <Text style={[styles.meta, wide && { flex: 2 }]}>use the same collection and paths when you re-import, so stome can tell a note it already has from a new one.</Text>
        </View>

        <View style={styles.drop}>
          <View style={styles.dropText}>
            <Icon name="upload" size={24} color={theme.color.text.primary} />
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.dropTitle}>{Platform.OS === 'web' ? 'drop markdown, onenote, pdf or board image files, or choose them' : 'choose markdown, onenote, pdf or board image files'}</Text>
              <Text style={styles.meta}>up to 20 at a time · 1 MiB each · {rows.length} chosen</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="choose files" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onChoose} style={[styles.btn, styles.btnSec, busy && styles.disabled]}>
            <Text style={styles.btnSecText}>{rows.length ? 'choose more files' : 'choose files'}</Text>
          </Pressable>
        </View>

        {rows.length ? (
          <View>
            {wide ? (
              <View style={[styles.file, { paddingTop: 0 }]}>
                <View style={styles.fileIcon} />
                <Text style={[styles.eyebrow, styles.fileName]}>FILE</Text>
                <Text style={[styles.eyebrow, styles.filePath]}>SOURCE PATH</Text>
                <View style={styles.ib} />
              </View>
            ) : null}
            {rows.map((r, i) => {
              const warn = ambiguous(r);
              return (
                <View key={r.id} style={[styles.file, i === rows.length - 1 && { borderBottomWidth: 0 }, warn && styles.fileWarn]}>
                  <View style={styles.fileIcon}><Icon name={warn ? 'unclear' : 'note'} size={20} color={warn ? theme.color.status.warning.text : theme.color.text.primary} /></View>
                  <View style={styles.fileName}>
                    <Text style={styles.fileNameText}>{r.name}</Text>
                    {warn ? <Text style={styles.warnText}>two files share this name. add its folder.</Text> : null}
                  </View>
                  <TextInput
                    accessibilityLabel={`source path for ${r.name}`} value={r.path} onChangeText={(p) => onPath(r.id, p)}
                    editable={!busy && !r.disabled} autoCapitalize="none" autoCorrect={false}
                    style={[styles.inp, wide ? styles.filePath : styles.filePathNarrow, warn && { borderColor: theme.color.status.warning.fill }]}
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel={`remove ${r.name}`} disabled={busy || r.disabled} onPress={() => onRemove(r.id)} style={styles.ib}>
                    <Icon name="cross" size={16} color={theme.color.text.tertiary} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="cancel" onPress={onCancel} style={[styles.btn, styles.btnSec]}><Text style={styles.btnSecText}>cancel</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`preview ${rows.length} notes`} accessibilityState={{ disabled: !canPreview }} disabled={!canPreview} onPress={onPreview} style={[styles.btn, styles.btnPri, !canPreview && styles.disabled]}>
          <Text style={styles.btnPriText}>preview {rows.length} {rows.length === 1 ? 'note' : 'notes'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = createStyles((theme) => StyleSheet.create({
  stage: { gap: 20, width: '100%', maxWidth: 1160, alignSelf: 'center' },
  header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 },
  headerText: { gap: 6, flexShrink: 1 },
  title: { ...theme.text('screenTitle'), color: theme.color.text.primary },
  sub: { ...theme.text('body'), color: theme.color.text.secondary },
  meta: { ...theme.text('caption'), color: theme.color.text.tertiary },
  eyebrow: { ...theme.text('eyebrow'), color: theme.color.text.tertiary },
  section: { gap: 10 },
  steps: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNum: { width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.bg.inset },
  stepNumOn: { backgroundColor: theme.color.accent.bg },
  stepNumText: { fontSize: 12, fontWeight: '700', color: theme.color.text.secondary },
  stepNumTextOn: { color: theme.color.accent.fg },
  stepLabel: { ...theme.text('caption'), fontWeight: '500', color: theme.color.text.tertiary },
  stepLabelOn: { color: theme.color.text.primary },
  srcs: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  src: { gap: 8, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: theme.color.border.hairline, backgroundColor: theme.color.bg.surface },
  srcOn: { borderWidth: 2, borderColor: theme.color.text.primary, padding: 15 },
  srcOff: { backgroundColor: 'transparent', borderStyle: 'dashed' },
  srcHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  srcName: { ...theme.text('title'), fontSize: 17, lineHeight: 22, color: theme.color.text.primary },
  badge: { paddingVertical: 2, paddingHorizontal: 10, borderRadius: 999 },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  badgeOk: { backgroundColor: theme.color.status.success.wash },
  badgeOkText: { color: theme.color.status.success.text },
  badgeWarn: { backgroundColor: theme.color.status.warning.wash },
  badgeWarnText: { color: theme.color.status.warning.text },
  badgeMuted: { backgroundColor: theme.color.bg.inset },
  badgeMutedText: { color: theme.color.text.secondary },
  card: { backgroundColor: theme.color.bg.surface, borderWidth: 1, borderColor: theme.color.border.hairline, borderRadius: 24, paddingVertical: 20, paddingHorizontal: 24, gap: 16 },
  collectionRow: { gap: 12 },
  collectionRowWide: { flexDirection: 'row', alignItems: 'flex-end', gap: 16 },
  field: { gap: 6 },
  input: { ...theme.text('body'), minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border.strong, backgroundColor: theme.color.bg.canvas, paddingHorizontal: 12, color: theme.color.text.primary },
  drop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 18, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.color.border.strong, backgroundColor: theme.color.bg.canvas },
  dropText: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  dropTitle: { ...theme.text('buttonCompact'), color: theme.color.text.primary },
  file: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border.hairline },
  fileWarn: { backgroundColor: theme.color.status.warning.wash, marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 12, borderBottomWidth: 0 },
  fileIcon: { width: 28, alignItems: 'center' },
  fileName: { flex: 1, minWidth: 120 },
  fileNameText: { ...theme.text('bodySmall'), fontWeight: '500', color: theme.color.text.primary },
  filePath: { flex: 1.3, minWidth: 160 },
  filePathNarrow: { flexBasis: '100%', marginLeft: 40, flexGrow: 1 },
  warnText: { fontSize: 12, lineHeight: 16, color: theme.color.status.warning.text },
  inp: { minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border.hairline, backgroundColor: theme.color.bg.canvas, paddingHorizontal: 10, fontSize: 13, lineHeight: 18, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' }), color: theme.color.text.primary },
  ib: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  btn: { minHeight: 44, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnPri: { backgroundColor: theme.color.accent.bg },
  btnPriText: { ...theme.text('buttonCompact'), color: theme.color.accent.fg },
  btnSec: { borderWidth: 1, borderColor: theme.color.border.strong },
  btnSecText: { ...theme.text('buttonCompact'), color: theme.color.text.primary },
  disabled: { opacity: 0.5 },
}));
