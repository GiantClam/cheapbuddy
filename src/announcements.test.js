import test from 'node:test';
import assert from 'node:assert/strict';
import { localizedAnnouncementContent, localizedAnnouncementTitle } from './announcements.js';

test('selects announcement text for the site language', () => {
  const announcement = {
    title: 'Legacy Chinese title',
    content: 'Legacy Chinese content',
    title_zh: '中文标题',
    title_en: 'English title',
    content_zh: '中文正文',
    content_en: 'English body',
  };

  assert.equal(localizedAnnouncementTitle(announcement, 'zh'), '中文标题');
  assert.equal(localizedAnnouncementContent(announcement, 'en'), 'English body');
});

test('falls back to existing announcement fields', () => {
  assert.equal(localizedAnnouncementTitle({ title: 'Existing title' }, 'en'), 'Existing title');
  assert.equal(localizedAnnouncementContent({ content_zh: '中文正文' }, 'en'), '中文正文');
});
