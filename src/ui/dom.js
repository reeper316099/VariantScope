// Tiny DOM helpers. Text always goes through textContent/append (never innerHTML) so API data
// can never inject markup, and no inline style attributes are ever written (strict CSP).

// Creates an element. Props: class, text, dataset, onclick-style handlers, or plain attributes.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

// Replaces a node's children with the given ones, skipping null/false (native append would
// write the text "null").
export function fill(node, ...children) {
  node.replaceChildren(
    ...children.flat().filter((c) => c !== null && c !== undefined && c !== false),
  );
}

// Removes all children of a node.
export function clear(node) {
  node.replaceChildren();
}

// Creates a link that opens in a new tab/window (Electron routes it to the system browser).
export function externalLink(href, text, label) {
  return el('a', {
    href,
    text,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': label ?? null,
    dataset: { external: '' },
  });
}
