// Panel states. Every panel has the same four parts and shows exactly one of them:
// skeleton (loading), message (empty or error, with optional Retry), or content (success).
import { clear, el } from './dom.js';

// Adds the skeleton and message parts to a panel (the HTML only provides the content part).
export function preparePanel(panel) {
  const lines = panel.dataset.skeleton === 'tall' ? 1 : 3;
  const skeleton = el(
    'div',
    { class: `panel-skeleton${lines === 1 ? ' tall' : ''}`, 'aria-hidden': 'true', hidden: true },
    ...Array.from({ length: lines === 1 ? 1 : 3 }, () => el('div', { class: 'shimmer' })),
  );
  const message = el('div', { class: 'panel-message', role: 'status', hidden: true });
  panel.prepend(skeleton, message);
}

// Shows one state: "loading" | "empty" | "error" | "ready". `message` is plain text.
export function setPanelState(panel, state, { message = '', onRetry = null } = {}) {
  const skeleton = panel.querySelector('.panel-skeleton');
  const box = panel.querySelector('.panel-message');
  const content = panel.querySelector('.panel-content');
  skeleton.hidden = state !== 'loading';
  box.hidden = state !== 'empty' && state !== 'error';
  content.hidden = state !== 'ready';
  panel.dataset.state = state;
  panel.setAttribute('aria-busy', String(state === 'loading'));
  if (!box.hidden) {
    clear(box);
    box.append(
      el('p', { class: state === 'error' ? 'message-error' : 'message-empty', text: message }),
    );
    if (state === 'error' && onRetry)
      box.append(
        el('button', { class: 'button', type: 'button', text: 'Retry', onclick: onRetry }),
      );
  }
}
