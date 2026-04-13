export interface Station {
  id: number;
  name: string;
  lat: number;
  lon: number;
  forecastId?: number; // if omitted, falls back to id
}

export interface PanelContext {
  apiBase: string;
  station: Station;
  apiUrl(endpoint: string): string;
}

export interface Panel {
  mount(root: HTMLElement, ctx: PanelContext): void;
  refresh(): void | Promise<void>;
  intervalMs: number;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function svg(
  tag: string,
  attrs: Record<string, string | number> = {},
  ...children: Array<Node | string>
): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const c of children) {
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json() as Promise<T>;
}
