import { afterEach } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
  history.replaceState(null, '', '/');
});
