import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, Defs, G, Line, Pattern, Rect } from 'react-native-svg';

import { useStoneTheme } from '../../design-theme/src/primitives';
import { Icon } from '../ui/Icon';
import { BackgroundPicker } from './BackgroundPicker';
import { ElementRenderer } from './ElementRenderer';
import { StylePanel, type ElementStyle } from './StylePanel';
import { Toolbar } from './Toolbar';
import {
  BG_SPACING,
  DEFAULT_BACKGROUND,
  DEFAULT_STYLE,
  EXCALIDRAW_COLORS,
  type BackgroundPattern,
  type BackgroundSize,
  type CanvasTransform,
  type TextElement,
  type Tool,
  type WhiteboardElement,
} from './types';
import { createWhiteboardPanResponder, type TextEditState } from './useWhiteboardInput';

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;
const HISTORY_LIMIT = 50;

export function WhiteboardScreen({ onBack }: { onBack?: () => void } = {}) {
  const [elements, setElements] = useState<WhiteboardElement[]>([]);
  const [history, setHistory] = useState<WhiteboardElement[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [tool, setTool] = useState<Tool>('freedraw');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentStyle, setCurrentStyle] = useState<ElementStyle>(DEFAULT_STYLE);
  const [transform, setTransform] = useState<CanvasTransform>({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  const [showStylePanel, setShowStylePanel] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [bgPattern, setBgPattern] = useState<BackgroundPattern>(DEFAULT_BACKGROUND.pattern);
  const [bgSize, setBgSize] = useState<BackgroundSize>(DEFAULT_BACKGROUND.size);
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const canvasOriginRef = useRef({ x: 0, y: 0 });

  // Stable refs so the PanResponder (created once) always has fresh values
  const drawingRef = useRef<WhiteboardElement | null>(null);
  const dragRef = useRef<{
    id: string;
    initialBx: number;
    initialBy: number;
    origEl: WhiteboardElement;
    isDragging: boolean;
  } | null>(null);
  const lastTapRef = useRef<{ time: number; id: string | null } | null>(null);
  const panStartRef = useRef<{ ox: number; oy: number; tx: number; ty: number } | null>(null);
  const pinchRef = useRef<{ dist: number; scale: number; ox: number; oy: number } | null>(null);
  const transformRef = useRef(transform);
  const elementsRef = useRef(elements);
  const historyIndexRef = useRef(historyIndex);
  const selectedIdRef = useRef(selectedId);
  const pushHistoryRef = useRef<(els: WhiteboardElement[]) => void>(() => {});
  const toolRef = useRef(tool);
  const currentStyleRef = useRef(currentStyle);
  const setSelectedIdStable = useRef(setSelectedId);
  const setTextEditStable = useRef<(state: TextEditState) => void>((s) => setTextEdit(s));

  useEffect(() => { transformRef.current = transform; }, [transform]);
  useEffect(() => { elementsRef.current = elements; }, [elements]);
  useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { currentStyleRef.current = currentStyle; }, [currentStyle]);

  function pushHistory(newElements: WhiteboardElement[]) {
    const idx = historyIndexRef.current;
    setHistory((prev) => {
      const base = prev.slice(0, idx + 1);
      return [...base, newElements].slice(-HISTORY_LIMIT);
    });
    setHistoryIndex((i) => Math.min(i + 1, HISTORY_LIMIT - 1));
    setElements(newElements);
    elementsRef.current = newElements;
  }

  useEffect(() => {
    pushHistoryRef.current = pushHistory;
    setTextEditStable.current = (s: TextEditState) => setTextEdit(s);
  });

  function undo() {
    if (historyIndex === 0) return;
    const idx = historyIndex - 1;
    setHistoryIndex(idx);
    setElements(history[idx] ?? []);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    const idx = historyIndex + 1;
    setHistoryIndex(idx);
    setElements(history[idx] ?? []);
  }

  function clear() {
    pushHistory([]);
    setSelectedId(null);
  }

  function deleteSelected() {
    if (!selectedId) return;
    pushHistory(elements.filter((e) => e.id !== selectedId));
    setSelectedId(null);
  }

  // Create PanResponder once — lives in useWhiteboardInput.ts (opted out of React Compiler).
  /* eslint-disable react-hooks/refs */
  const [panHandlers] = useState(() =>
    createWhiteboardPanResponder({
      transformRef: transformRef as React.RefObject<CanvasTransform>,
      elementsRef: elementsRef as React.RefObject<WhiteboardElement[]>,
      toolRef: toolRef as React.RefObject<Tool>,
      currentStyleRef: currentStyleRef as React.RefObject<ElementStyle>,
      selectedIdRef: selectedIdRef as React.RefObject<string | null>,
      dragRef,
      drawingRef,
      lastTapRef,
      panStartRef,
      pinchRef,
      pushHistoryRef: pushHistoryRef as React.RefObject<(els: WhiteboardElement[]) => void>,
      setSelectedIdRef: setSelectedIdStable as React.RefObject<(id: string | null) => void>,
      setTextEditRef: setTextEditStable as React.RefObject<(state: TextEditState) => void>,
      setTransform,
      setElements,
      canvasOriginRef,
    }).panHandlers,
  );
  /* eslint-enable react-hooks/refs */

  // Web: scroll-wheel pan/zoom + spacebar hand mode + Delete key
  const svgContainerRef = useRef<React.ElementRef<typeof View>>(null);
  const spaceHandRef = useRef(false);

  // Keep canvasOriginRef accurate for TextInput placement (boardToRootScreen)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const update = () => {
      const node = (svgContainerRef.current as unknown as { _nativeTag?: HTMLElement } | null)
        ?._nativeTag as HTMLElement | undefined;
      if (node) {
        const rect = node.getBoundingClientRect();
        canvasOriginRef.current = { x: rect.left, y: rect.top };
      }
    };
    // Run immediately after mount so the TextInput is positioned correctly from the start
    update();
    // Also run after first paint in case layout hasn't settled yet
    const raf = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = (svgContainerRef.current as unknown as { _nativeTag?: HTMLElement } | null)
      ?._nativeTag as HTMLElement | undefined;
    if (!node) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom on trackpad or ctrl+scroll
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        setTransform((t) => {
          const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor));
          const mx = e.offsetX;
          const my = e.offsetY;
          return {
            scale: newScale,
            offsetX: mx - (mx - t.offsetX) * (newScale / t.scale),
            offsetY: my - (my - t.offsetY) * (newScale / t.scale),
          };
        });
      } else {
        // Plain scroll = pan (matches Excalidraw default)
        setTransform((t) => ({
          ...t,
          offsetX: t.offsetX - e.deltaX,
          offsetY: t.offsetY - e.deltaY,
        }));
      }
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  // Prevent SVG text selection on web (cursor drag would otherwise highlight text)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = document.createElement('style');
    el.textContent = 'svg text { user-select: none; -webkit-user-select: none; cursor: default; }';
    document.head.appendChild(el);
    return () => { document.head.removeChild(el); };
  }, []);

  // Delete key + spacebar hand mode on web
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' && !spaceHandRef.current && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        spaceHandRef.current = true;
        toolRef.current = 'hand';
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        const id = selectedIdRef.current;
        if (!id) return;
        pushHistoryRef.current(elementsRef.current.filter((el) => el.id !== id));
        setSelectedId(null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && spaceHandRef.current) {
        spaceHandRef.current = false;
        toolRef.current = tool;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [tool]);

  function commitText(value: string) {
    if (!textEdit) return;
    const trimmed = value.trim();

    if (textEdit.isEditing) {
      if (trimmed.length > 0) {
        pushHistory(
          elements.map((e) =>
            e.id === textEdit.id
              ? ({ ...e, text: trimmed, width: trimmed.length * 12 } as TextElement)
              : e,
          ),
        );
      } else {
        pushHistory(elements.filter((e) => e.id !== textEdit.id));
      }
    } else if (trimmed.length > 0) {
      const isLabel = textEdit.id.includes('__label');
      const el: TextElement = {
        id: textEdit.id,
        type: 'text',
        // For labels, center the text on the shape; for free text, place at tap point
        x: isLabel ? textEdit.x - (trimmed.length * 7) : textEdit.x,
        y: isLabel ? textEdit.y - 10 : textEdit.y,
        angle: 0,
        text: trimmed,
        fontSize: 20,
        width: trimmed.length * 12,
        height: 24,
        strokeColor: currentStyle.strokeColor,
        backgroundColor: 'transparent',
        strokeWidth: currentStyle.strokeWidth,
        strokeStyle: currentStyle.strokeStyle,
        opacity: 1,
        roughness: currentStyle.roughness,
        fillStyle: currentStyle.fillStyle,
      };
      pushHistory([...elements, el]);
    }
    setTextEdit(null);
  }

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setCanvasSize({ width, height });
    // On web, also capture the canvas's screen-space origin so PanResponder coords can be corrected
    if (Platform.OS === 'web') {
      const node = (svgContainerRef.current as unknown as { _nativeTag?: HTMLElement } | null)
        ?._nativeTag as HTMLElement | undefined;
      if (node) {
        const rect = node.getBoundingClientRect();
        canvasOriginRef.current = { x: rect.left, y: rect.top };
      }
    }
  }, []);

  const theme = useStoneTheme();
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  const cursor = tool === 'hand' ? 'grab' : tool === 'text' ? 'text' : 'crosshair';

  return (
    <View style={styles.root}>
      {/* Canvas */}
      <View
        ref={svgContainerRef}
        style={[
          styles.canvas,
          Platform.OS === 'web' && ({ cursor, userSelect: 'none', WebkitUserSelect: 'none' } as object),
        ]}
        onLayout={onLayout}
        {...panHandlers}
      >
        <Svg width={canvasSize.width} height={canvasSize.height}>
          {bgPattern !== 'blank' && (() => {
            const sp = BG_SPACING[bgSize] * transform.scale;
            const ox = transform.offsetX % sp;
            const oy = transform.offsetY % sp;
            return (
              <Defs>
                <Pattern id="wb-bg" x={ox} y={oy} width={sp} height={sp} patternUnits="userSpaceOnUse">
                  {bgPattern === 'dots' && (
                    <Circle cx={sp / 2} cy={sp / 2} r={1.2} fill="#adb5bd" opacity={0.6} />
                  )}
                  {bgPattern === 'lines' && (
                    <Line x1={0} y1={sp} x2={sp} y2={sp} stroke="#adb5bd" strokeWidth={1} opacity={0.4} />
                  )}
                  {bgPattern === 'grid' && (
                    <>
                      <Line x1={0} y1={sp} x2={sp} y2={sp} stroke="#adb5bd" strokeWidth={0.75} opacity={0.4} />
                      <Line x1={sp} y1={0} x2={sp} y2={sp} stroke="#adb5bd" strokeWidth={0.75} opacity={0.4} />
                    </>
                  )}
                </Pattern>
              </Defs>
            );
          })()}
          <Rect x={0} y={0} width={canvasSize.width} height={canvasSize.height} fill={EXCALIDRAW_COLORS.canvasBg} />
          {bgPattern !== 'blank' && (
            <Rect x={0} y={0} width={canvasSize.width} height={canvasSize.height} fill="url(#wb-bg)" />
          )}
          <G transform={`translate(${transform.offsetX}, ${transform.offsetY}) scale(${transform.scale})`}>
            {elements.map((el) => (
              // Hide the element being edited so the TextInput appears in its place
              textEdit?.isEditing && el.id === textEdit.id ? null : (
                <ElementRenderer key={el.id} element={el} selected={selectedId === el.id} />
              )
            ))}
          </G>
        </Svg>

      </View>

      {/* TextInput rendered outside the PanResponder View so it receives mouse events on web */}
      {textEdit ? (
        <TextInput
          autoFocus
          multiline
          style={[
            styles.textInput,
            { left: textEdit.screenX, top: textEdit.screenY, fontSize: 20 * transform.scale, color: currentStyle.strokeColor },
          ]}
          value={textEdit.value}
          onChangeText={(v) => setTextEdit((prev) => (prev ? { ...prev, value: v } : null))}
          onBlur={() => commitText(textEdit.value)}
          onSubmitEditing={() => commitText(textEdit.value)}
          blurOnSubmit
        />
      ) : null}

      {/* Delete button — shown when an element is selected */}
      {selectedId ? (
        <Pressable
          style={[styles.deleteButton, { backgroundColor: theme.color.status.danger.wash, borderColor: theme.color.status.danger.fill, shadowColor: theme.color.text.primary }]}
          onPress={deleteSelected}
          accessibilityLabel="Delete selected element"
        >
          <Icon name="trash" size={20} color={theme.color.status.danger.text} />
        </Pressable>
      ) : null}

      {/* Style panel */}
      {showStylePanel ? (
        <View style={onBack ? styles.stylePanelWrapperWithBack : styles.stylePanelWrapper} pointerEvents="box-none">
          <StylePanel
            style={currentStyle}
            onChange={(patch) => setCurrentStyle((prev) => ({ ...prev, ...patch }))}
          />
        </View>
      ) : null}

      {/* Back to Notes button */}
      {onBack ? (
        <Pressable
          style={[styles.backButton, { backgroundColor: theme.color.bg.surface, shadowColor: theme.color.text.primary }]}
          onPress={onBack}
          accessibilityLabel="Back to Notes"
        >
          <Icon name="chevronLeft" size={18} color={theme.color.text.secondary} />
          <Text style={[styles.backLabel, { color: theme.color.text.secondary }]}>Notes</Text>
        </Pressable>
      ) : null}

      {/* Properties toggle */}
      <Pressable
        style={[styles.propertiesButton, onBack && styles.propertiesButtonWithBack, { backgroundColor: theme.color.bg.surface, shadowColor: theme.color.text.primary }]}
        onPress={() => { setShowStylePanel((v) => !v); setShowBgPicker(false); }}
        accessibilityLabel="Toggle style panel"
      >
        <Icon name="more" size={20} color={theme.color.text.secondary} />
      </Pressable>

      {/* Background picker toggle */}
      <Pressable
        style={[styles.bgButton, onBack && styles.bgButtonWithBack, { backgroundColor: theme.color.bg.surface, shadowColor: theme.color.text.primary }]}
        onPress={() => { setShowBgPicker((v) => !v); setShowStylePanel(false); }}
        accessibilityLabel="Toggle background"
      >
        <Icon name="gridPattern" size={20} color={theme.color.text.secondary} />
      </Pressable>

      {/* Background picker panel */}
      {showBgPicker ? (
        <View style={[styles.bgPickerWrapper, onBack && styles.bgPickerWrapperWithBack]} pointerEvents="box-none">
          <BackgroundPicker
            pattern={bgPattern}
            size={bgSize}
            onPatternChange={setBgPattern}
            onSizeChange={setBgSize}
          />
        </View>
      ) : null}

      {/* Zoom indicator */}
      <View style={[styles.zoomBadge, { backgroundColor: theme.color.bg.surface }]} pointerEvents="none">
        <Text style={[styles.zoomText, { color: theme.color.text.secondary }]}>{Math.round(transform.scale * 100)}%</Text>
      </View>

      {/* Toolbar */}
      <View style={styles.toolbarWrapper} pointerEvents="box-none">
        <Toolbar
          activeTool={tool}
          onToolChange={(t) => { setTool(t); setSelectedId(null); }}
          onUndo={undo}
          onRedo={redo}
          onClear={clear}
          canUndo={canUndo}
          canRedo={canRedo}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: EXCALIDRAW_COLORS.canvasBg },
  canvas: { flex: 1 },
  toolbarWrapper: {
    alignItems: 'center',
    bottom: 24,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  stylePanelWrapper: { left: 16, position: 'absolute', top: 70 },
  stylePanelWrapperWithBack: { left: 16, position: 'absolute', top: 120 },
  backButton: {
    alignItems: 'center',
    borderRadius: 10,
    elevation: 4,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    left: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: 'absolute',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    top: 20,
  },
  backLabel: { fontSize: 14, fontWeight: '500' },
  propertiesButton: {
    alignItems: 'center',
    borderRadius: 10,
    elevation: 4,
    height: 40,
    justifyContent: 'center',
    left: 16,
    position: 'absolute',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    top: 20,
    width: 40,
  },
  propertiesButtonWithBack: { top: 70 },
  bgButton: {
    alignItems: 'center',
    borderRadius: 10,
    elevation: 4,
    height: 40,
    justifyContent: 'center',
    left: 16,
    position: 'absolute',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    top: 70,
    width: 40,
  },
  bgButtonWithBack: { top: 120 },
  bgPickerWrapper: { left: 64, position: 'absolute', top: 70 },
  bgPickerWrapperWithBack: { left: 64, position: 'absolute', top: 120 },
  deleteButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    elevation: 4,
    height: 40,
    justifyContent: 'center',
    position: 'absolute',
    right: 16,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    top: 20,
    width: 40,
  },
  zoomBadge: {
    borderRadius: 6,
    bottom: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: 'absolute',
    right: 16,
  },
  zoomText: { fontSize: 12, fontWeight: '600' },
  textInput: {
    backgroundColor: 'transparent',
    fontFamily: 'System',
    minWidth: 60,
    padding: 0,
    position: 'absolute',
  },
});
