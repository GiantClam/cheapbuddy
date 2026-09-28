export function localizedAnnouncementField(announcement, field, language) {
  const normalizedLanguage = String(language || '').toLowerCase();
  const preferredSuffix = normalizedLanguage.startsWith('zh') ? 'zh' : 'en';
  const fallbackSuffix = preferredSuffix === 'zh' ? 'en' : 'zh';
  const preferred = String(announcement?.[`${field}_${preferredSuffix}`] || '').trim();
  const fallback = String(announcement?.[`${field}_${fallbackSuffix}`] || '').trim();
  const legacy = String(announcement?.[field] || '').trim();

  return preferred || fallback || legacy;
}

export function localizedAnnouncementTitle(announcement, language) {
  return localizedAnnouncementField(announcement, 'title', language);
}

export function localizedAnnouncementContent(announcement, language) {
  return localizedAnnouncementField(announcement, 'content', language);
}
