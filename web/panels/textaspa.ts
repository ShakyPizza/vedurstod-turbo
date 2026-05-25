import type { Panel } from './types.ts';
import { el, getJson } from './types.ts';

interface Textaspa {
  title: string;
  createdAt: string | null;
  paragraphs: string[];
}

const TEXTASPA_FALLBACKS = [
  'Veðurfræðingur er að fylgjast með málningu þorna og hefur ekki tíma til hugleiðslu.',
  'Veðurfræðingur heyrir grasið vaxa en hefur ekki leitt hugann að veðri í dag.',
  'Yfir landinu er hæð lengst uppi og veðurfræðingur kúrir þar með henni.',
  'Fullkomin áttleysa í dag, drengur. Veðurfræðingur hefur ekki leitt hugann að veðrinu vegna heyanna.',
  'Brakandi þurrkur og allir úti á túni. Veðurfræðingur hefur ekki leitt hugann að veðri í dag vegna heyanna.',
  'Vinsamlegast dokið við, veðurfræðingur er að hugleiða í þessum rituðu orðum. Ef ekkert heyrist frá honum fyrir kaffi má hringja á björgunarsveit.',
  'Vakthafandi veðurfræðingur er að hita upp ábrystir sem konan útbjó fyrr í dag. Hugleiðingar kynntar síðar.',
];

export function textaspaPanel(): Panel {
  let body: HTMLElement;
  let timestampLabel: HTMLElement;
  let statusLamp: HTMLElement;
  let statusText: Text;
  let url = '/api/textaspa';

  return {
    intervalMs: 30 * 60 * 1000,
    mount(root, ctx) {
      url = ctx.apiUrl('textaspa');
      root.innerHTML = '';

      const header = el(
        'header',
        { class: 'panel__header' },
        el('h2', { class: 'panel__title' }, 'HUGLEIÐINGAR VEÐURFRÆÐINGS'),
        el('div', { class: 'panel__status' }),
      );
      statusLamp = el('span', { class: 'status-lamp' });
      statusText = document.createTextNode(' SÆKI');
      header.querySelector('.panel__status')!.append(statusLamp, statusText);

      body = el('div', { class: 'panel__body panel__body--textaspa' });
      body.append(el('p', { class: 'textaspa__para textaspa__para--fallback' }, 'Sæki hugleiðingar...'));

      timestampLabel = el('span', { class: 'panel__footer-value' }, '—');
      const footer = el(
        'footer',
        { class: 'panel__footer' },
        el('span', { class: 'panel__footer-label' }, 'GEFIÐ ÚT'),
        timestampLabel,
      );

      root.append(header, body, footer);
    },
    async refresh() {
      try {
        const spa = await getJson<Textaspa>(url);
        body.innerHTML = '';
        const paragraphs = spa.paragraphs.filter((p) => p.trim().length > 0);
        if (paragraphs.length === 0) {
          const phrase = TEXTASPA_FALLBACKS[Math.floor(Math.random() * TEXTASPA_FALLBACKS.length)];
          body.append(el('p', { class: 'textaspa__para textaspa__para--fallback' }, phrase));
        } else {
          for (const para of paragraphs) {
            body.append(el('p', { class: 'textaspa__para' }, para));
          }
        }

        if (spa.createdAt) {
          const fmt = new Intl.DateTimeFormat('is-IS', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit',
            hour12: false,
            timeZone: 'Atlantic/Reykjavik',
          });
          timestampLabel.textContent = fmt.format(new Date(spa.createdAt));
        }
        statusLamp.classList.add('status-lamp--on');
        statusLamp.classList.remove('status-lamp--alert');
        statusText.data = ' TENGT';
      } catch (err) {
        console.warn('textaspa refresh failed', err);
        statusLamp.classList.remove('status-lamp--on');
        statusLamp.classList.add('status-lamp--alert');
        statusText.data = ' BILUN';
      }
    },
  };
}
