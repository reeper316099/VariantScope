// Loads a saved API response from tests/fixtures (JSON is parsed, anything else returned as text).
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Returns the fixture's contents; `_fixture` (the provenance note) is left in place on purpose.
export function fixture(name) {
  const text = readFileSync(path.join(import.meta.dirname, '..', 'fixtures', name), 'utf8');
  return name.endsWith('.json') ? JSON.parse(text) : text;
}
