import type { Panel } from './types.ts';
import { el } from './types.ts';

interface PlaceholderStatus {
  label: string;
  alert?: boolean;
}

export function placeholderPanel(label: string, note: string, status?: PlaceholderStatus): Panel {
  return {
    intervalMs: 0,
    mount(root) {
      root.innerHTML = '';
      root.classList.add('panel--placeholder');
      const headerChildren: Node[] = [el('h2', { class: 'panel__title' }, label)];
      if (status) {
        headerChildren.push(
          el(
            'div',
            { class: 'panel__status' },
            el('span', { class: `status-lamp ${status.alert ? 'status-lamp--alert' : 'status-lamp--on'}` }),
            el('span', {}, status.label),
          ),
        );
      }
      root.append(
        el('header', { class: 'panel__header' }, ...headerChildren),
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
