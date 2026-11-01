/**
 * Minimal glob support for the action: `**`, `*` and `?`, matched against
 * forward-slash paths. Small on purpose — the action should not install a
 * dependency tree just to find files.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn']);
const BACKSLASH = String.fromCharCode(92);
// Characters that mean something in a RegExp and must be escaped in a literal.
const SPECIAL = new Set([46, 43, 94, 36, 123, 125, 40, 41, 124, 91, 93, 92]);

/** Every file under `root`, as forward-slash relative paths. */
export function walk(root, dir = '.') {
  const found = [];
  let entries;
  try {
    entries = readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const rel = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...walk(root, rel));
    } else if (entry.isFile()) {
      found.push(rel);
    }
  }
  return found;
}

export function globToRegExp(glob) {
  const pattern = String(glob).replace(/\\/g, '/').replace(/^\.\//, '');
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          source += '(?:[^/]+/)*'; // zero or more directories
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if (SPECIAL.has(char.charCodeAt(0))) {
      source += BACKSLASH + char;
    } else {
      source += char;
    }
  }
  return new RegExp(`^${source}$`, 'i');
}
