import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeHtml, formatMessage } from '../../utils/html';

test('escapeHtml escapes reserved html characters', () => {
  const input = `<script>alert('x') & \"y\"</script>`;
  assert.equal(
    escapeHtml(input),
    '&lt;script&gt;alert(&#39;x&#39;) &amp; &quot;y&quot;&lt;/script&gt;'
  );
});

test('escapeHtml leaves plain text unchanged', () => {
  assert.equal(escapeHtml('MatUp League Update'), 'MatUp League Update');
});

test('formatMessage escapes html and converts new lines to <br />', () => {
  const input = "Line 1\nLine <2>\r\nLine '3'";
  assert.equal(
    formatMessage(input),
    'Line 1<br />Line &lt;2&gt;<br />Line &#39;3&#39;'
  );
});
