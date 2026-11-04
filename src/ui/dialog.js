// A small modal dialog built on the native <dialog> element (focus is trapped and Esc closes it).
// Content is built with el() so nothing is ever inserted as HTML.
import { el } from './dom.js';

// Opens a dialog with a title, body nodes and buttons. Each action is {label, primary, danger,
// onClick}; onClick returns false to keep the dialog open (for example when a name is invalid).
// Focus goes back to `opener` when it closes. Returns the dialog element.
export function openDialog({ title, body = [], actions = [], opener = null, label = title }) {
  const dialog = el('dialog', { class: 'dialog', 'aria-label': label });
  const buttons = actions.map((action) =>
    el('button', {
      class: `button${action.primary ? ' button-primary' : ''}${action.danger ? ' button-danger' : ''}`,
      type: 'button',
      text: action.label,
      onclick: async () => {
        if ((await action.onClick?.()) !== false) dialog.close();
      },
    }),
  );
  const cancel = el('button', {
    class: 'button',
    type: 'button',
    text: 'Cancel',
    onclick: () => dialog.close(),
  });
  dialog.append(
    el('h3', { text: title }),
    ...body,
    el('div', { class: 'dialog-actions' }, cancel, ...buttons),
  );
  dialog.addEventListener('close', () => {
    dialog.remove();
    opener?.focus?.();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
