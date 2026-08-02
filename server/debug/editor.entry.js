import { basicSetup, EditorView } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';

const studioTheme = EditorView.theme({
  '&': {
    height: '512px',
    width: '100%',
    backgroundColor: '#10141c',
    color: '#d8dee9',
    fontSize: '13px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    lineHeight: '1.5',
  },
  '.cm-content': { caretColor: '#6ec8ff' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#6ec8ff' },
  '&.cm-focused': { outline: '1px solid #50a7ff' },
  '.cm-gutters': {
    backgroundColor: '#0d1118',
    color: '#596579',
    borderRight: '1px solid #303747',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#17202d' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#29466a' },
}, { dark: true });

class DeviceCodeEditor {
  constructor(parent) {
    this.listener = null;
    this.suppressChanges = false;
    this.view = new EditorView({
      parent,
      extensions: [
        basicSetup,
        javascript(),
        keymap.of([indentWithTab]),
        studioTheme,
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
}

window.DeviceCodeEditor = DeviceCodeEditor;
