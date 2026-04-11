import type { Panel } from './types.ts';
import { el } from './types.ts';

export function placeholderPanel(label: string, note: string): Panel {
  return {
    intervalMs: 0,
    mount(root) {
      root.innerHTML = '';
      root.classList.add('panel--placeholder');
      root.append(
        el('header', { class: 'panel__header' }, el('h2', { class: 'panel__title' }, label)),
        el(
          'div',
          { class: 'panel__body panel__body--empty' },
          el('div', { class: 'placeholder__screen' }, el('span', { class: 'placeholder__note' }, note)),
        ),
      );
    },
    refresh() {},
  };
}
