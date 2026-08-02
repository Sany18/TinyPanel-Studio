import { basicSetup, EditorView } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { Decoration, keymap, ViewPlugin, WidgetType } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { Compartment } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const HEX_COLOR = /(["'])(#[0-9a-f]{6})\1/gi;

class ColorPickerWidget extends WidgetType {
  constructor(color, from, to) {
    super();
    this.color = color;
    this.from = from;
    this.to = to;
  }

  eq(other) {
    return this.color === other.color && this.from === other.from && this.to === other.to;
  }

  toDOM(view) {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = this.color;
    input.className = 'cm-color-picker';
    input.title = `Change ${this.color}`;
    input.setAttribute('aria-label', `Change color ${this.color}`);
    // Keep CodeMirror from treating interaction with the native picker as an
    // editor click. Apply only after selection is committed: dispatching on
    // every `input` rebuilds this widget and closes some browsers' picker.
    for (const eventName of ['pointerdown', 'mousedown', 'click']) {
      input.addEventListener(eventName, (event) => event.stopPropagation());
    }
    input.addEventListener('change', () => {
      view.dispatch({ changes: { from: this.from, to: this.to, insert: input.value } });
    });
    return input;
  }

  ignoreEvent() { return true; }
}

function colorDecorations(view) {
  const widgets = [];
  for (const range of view.visibleRanges) {
    const text = view.state.doc.sliceString(range.from, range.to);
    HEX_COLOR.lastIndex = 0;
    let match;
    while ((match = HEX_COLOR.exec(text))) {
      const literalStart = range.from + match.index;
      const colorFrom = literalStart + 1;
      const colorTo = colorFrom + match[2].length;
      widgets.push(Decoration.widget({
        widget: new ColorPickerWidget(match[2], colorFrom, colorTo),
        side: 1,
      }).range(literalStart + match[0].length));
    }
  }
  return Decoration.set(widgets, true);
}

const inlineColorPickers = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = colorDecorations(view); }

  update(update) {
    if (update.docChanged || update.viewportChanged) this.decorations = colorDecorations(update.view);
  }
}, { decorations: (plugin) => plugin.decorations });

function createTheme(colors, dark) {
  return EditorView.theme({
    '&': {
    height: '512px',
    width: '100%',
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: '13px',
    },
    '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    lineHeight: '1.5',
    },
    '.cm-content': { caretColor: colors.accent },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: colors.accent },
    '&.cm-focused': { outline: `1px solid ${colors.focus}` },
    '.cm-gutters': {
    backgroundColor: colors.gutter,
    color: colors.gutterText,
    borderRight: '1px solid #303747',
    },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: colors.activeLine },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: colors.selection },
    '.cm-color-picker': {
    width: '16px',
    height: '16px',
    margin: '0 2px 0 6px',
    padding: '0',
    verticalAlign: '-3px',
    border: '1px solid #718096',
    borderRadius: '4px',
    background: 'transparent',
    cursor: 'pointer',
    },
    '.cm-color-picker::-webkit-color-swatch-wrapper': { padding: '1px' },
    '.cm-color-picker::-webkit-color-swatch': { border: '0', borderRadius: '2px' },
  }, { dark });
}

const themes = {
  studio: createTheme({
    background: '#10141c', foreground: '#d8dee9', accent: '#6ec8ff', focus: '#50a7ff',
    gutter: '#0d1118', gutterText: '#596579', activeLine: '#17202d', selection: '#29466a',
  }, true),
  midnight: createTheme({
    background: '#070812', foreground: '#e6e1ff', accent: '#ff70c8', focus: '#a879ff',
    gutter: '#04050b', gutterText: '#665f82', activeLine: '#151128', selection: '#442d68',
  }, true),
  light: createTheme({
    background: '#f7f8fb', foreground: '#222631', accent: '#006bd6', focus: '#2684ff',
    gutter: '#eceff4', gutterText: '#778196', activeLine: '#e8f1ff', selection: '#bdd8ff',
  }, false),
};

const colorSchemes = {
  neon: HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier], color: '#d000d8' },
    { tag: [tags.variableName, tags.propertyName], color: '#003cff' },
    { tag: [tags.string, tags.special(tags.string)], color: '#ff2020' },
    { tag: [tags.number, tags.bool, tags.null], color: '#00865f' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#bf5b00' },
    { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: '#006eff' },
  ]),
  monokai: HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier], color: '#f92672' },
    { tag: [tags.variableName, tags.propertyName], color: '#f8f8f2' },
    { tag: [tags.string, tags.special(tags.string)], color: '#e6db74' },
    { tag: [tags.number, tags.bool, tags.null], color: '#ae81ff' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#75715e', fontStyle: 'italic' },
    { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: '#a6e22e' },
  ]),
  ocean: HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier], color: '#c792ea' },
    { tag: [tags.variableName, tags.propertyName], color: '#82aaff' },
    { tag: [tags.string, tags.special(tags.string)], color: '#c3e88d' },
    { tag: [tags.number, tags.bool, tags.null], color: '#f78c6c' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#546e7a', fontStyle: 'italic' },
    { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: '#89ddff' },
  ]),
};

class DeviceCodeEditor {
  constructor(parent) {
    this.listener = null;
    this.saveListener = null;
    this.suppressChanges = false;
    this.themeCompartment = new Compartment();
    this.colorSchemeCompartment = new Compartment();
    this.view = new EditorView({
      parent,
      extensions: [
        basicSetup,
        javascript(),
        keymap.of([
          indentWithTab,
          {
            key: 'Mod-s',
            run: () => {
              if (this.saveListener) this.saveListener();
              return true;
            },
          },
        ]),
        inlineColorPickers,
        this.themeCompartment.of(themes.studio),
        this.colorSchemeCompartment.of(syntaxHighlighting(colorSchemes.monokai)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !this.suppressChanges && this.listener) this.listener();
        }),
      ],
    });
  }

  getValue() {
    return this.view.state.doc.toString();
  }

  setValue(value) {
    this.suppressChanges = true;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } });
    this.suppressChanges = false;
  }

  onChange(listener) {
    this.listener = listener;
  }

  onSave(listener) {
    this.saveListener = listener;
  }

  setTheme(name) {
    const selected = themes[name] ? name : 'studio';
    this.view.dispatch({ effects: this.themeCompartment.reconfigure(themes[selected]) });
    return selected;
  }

  setColorScheme(name) {
    const selected = colorSchemes[name] ? name : 'monokai';
    this.view.dispatch({
      effects: this.colorSchemeCompartment.reconfigure(syntaxHighlighting(colorSchemes[selected])),
    });
    return selected;
  }
}

window.DeviceCodeEditor = DeviceCodeEditor;
