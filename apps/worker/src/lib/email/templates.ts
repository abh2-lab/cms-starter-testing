import type { EmailMessage } from '@cms/email';
import type { EmailSendJob } from '@cms/queue';

/**
 * Build the email body for a given job kind. Plain TS string builders — no
 * template engine. Each kind links back to the admin editor so the
 * recipient can act on the message in one click.
 *
 * `siteUrl` is the tenant's configured Site URL (siteSettings.siteUrl). When
 * null, links are replaced with text directions ("Find it in admin under
 * Content") — the email still ships, just without the clickable shortcut.
 *
 * `previewUrl` would point at the public site; for now we just link to the
 * admin content row (the recipient is always an admin user).
 */
export function renderEmail(
  job: EmailSendJob,
  siteUrl: string | null,
): EmailMessage {
  const link = contentLink(siteUrl, job.context.contentId);

  switch (job.kind) {
    case 'review_requested': {
      const subject = `Review requested: ${job.context.contentTitle}`;
      const text =
        `${job.context.actorDisplayName} sent "${job.context.contentTitle}" for review.\n\n` +
        openCtaText(link) +
        (job.context.comment ? `\nNote: ${job.context.comment}\n` : '');
      const html = wrapHtml(
        `<p><strong>${escapeHtml(job.context.actorDisplayName)}</strong> sent ` +
          `${titleHtml(link, job.context.contentTitle)} ` +
          `for review.</p>` +
          (job.context.comment
            ? `<blockquote>${escapeHtml(job.context.comment)}</blockquote>`
            : '') +
          openCtaHtml(link),
      );
      return { to: job.to, subject, text, html };
    }
    case 'review_approved': {
      const subject = `Approved: ${job.context.contentTitle}`;
      const text =
        `${job.context.actorDisplayName} approved your draft "${job.context.contentTitle}".\n\n` +
        openCtaText(link) +
        (job.context.comment ? `\nNote: ${job.context.comment}\n` : '');
      const html = wrapHtml(
        `<p><strong>${escapeHtml(job.context.actorDisplayName)}</strong> approved your ` +
          `draft ${titleHtml(link, job.context.contentTitle)}.</p>` +
          (job.context.comment
            ? `<blockquote>${escapeHtml(job.context.comment)}</blockquote>`
            : ''),
      );
      return { to: job.to, subject, text, html };
    }
    case 'review_rejected': {
      const subject = `Changes requested: ${job.context.contentTitle}`;
      const text =
        `${job.context.actorDisplayName} sent your draft "${job.context.contentTitle}" back for changes.\n\n` +
        openCtaText(link) +
        (job.context.comment ? `\nNote: ${job.context.comment}\n` : '');
      const html = wrapHtml(
        `<p><strong>${escapeHtml(job.context.actorDisplayName)}</strong> sent your ` +
          `draft ${titleHtml(link, job.context.contentTitle)} ` +
          `back for changes.</p>` +
          (job.context.comment
            ? `<blockquote>${escapeHtml(job.context.comment)}</blockquote>`
            : ''),
      );
      return { to: job.to, subject, text, html };
    }
    case 'reader_submission': {
      // actorDisplayName = submitter name; comment = submitter email.
      const subject = `New reader submission: ${job.context.contentTitle}`;
      const text =
        `${job.context.actorDisplayName} submitted "${job.context.contentTitle}" for review.\n\n` +
        (job.context.comment
          ? `Submitter email: ${job.context.comment}\n\n`
          : '') +
        openCtaText(link);
      const html = wrapHtml(
        `<p><strong>${escapeHtml(job.context.actorDisplayName)}</strong> submitted ` +
          `${titleHtml(link, job.context.contentTitle)} for review.</p>` +
          (job.context.comment
            ? `<p style="color:#666;font-size:13px">Submitter email: ${escapeHtml(job.context.comment)}</p>`
            : '') +
          openCtaHtml(link),
      );
      return { to: job.to, subject, text, html };
    }
  }
}

function contentLink(siteUrl: string | null, contentId: string): string | null {
  if (!siteUrl) return null;
  return `${stripTrailingSlash(siteUrl)}/admin/content/${contentId}`;
}

function titleHtml(link: string | null, title: string): string {
  return link
    ? `<a href="${link}">${escapeHtml(title)}</a>`
    : `<strong>${escapeHtml(title)}</strong>`;
}

function openCtaText(link: string | null): string {
  return link
    ? `Open it in the editor: ${link}\n`
    : `Find it in admin under Content.\n`;
}

function openCtaHtml(link: string | null): string {
  return link
    ? `<p><a href="${link}">Open it in the editor</a></p>`
    : `<p>Find it in admin under Content.</p>`;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapHtml(body: string): string {
  // Minimal layout — keep it deliberately bland; news-CMS admin emails are
  // utilitarian, not marketing. Inline styles only (most clients strip
  // <style>).
  return `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;max-width:560px;margin:24px auto;color:#1a1a1a">
${body}
<hr style="border:none;border-top:1px solid #eee;margin:24px 0">
<p style="color:#666;font-size:12px">This is an automated notification from your CMS.</p>
</body></html>`;
}
