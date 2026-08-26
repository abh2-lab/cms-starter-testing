import { defineEventHandler, getRequestURL, setHeader } from 'h3';

export default defineEventHandler((event) => {
  const origin = getRequestURL(event).origin;
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8');
  return `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
});
