(() => {
  'use strict';

  class CommentDataError extends Error {
    constructor(message) {
      super(message);
      this.messages = [message];
    }
  }

  function plainText(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    template.content.querySelectorAll('script, style, iframe, object').forEach((node) => node.remove());
    template.content.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
    template.content.querySelectorAll('p, div, li').forEach((node) => node.append('\n'));
    return template.content.textContent.trim();
  }

  function originalPostUrl(config) {
    const url = new URL(config.apiBaseUrl, window.location.origin);
    if (!url.pathname.endsWith('/wp-json/wp/v2')) return null;
    url.pathname = url.pathname.slice(0, -'wp-json/wp/v2'.length);
    url.search = '';
    url.searchParams.set(config.targetType === 'page' ? 'page_id' : 'p', String(config.targetPublicId));
    url.hash = 'comments';
    return url.href;
  }

  function endpoint(config, page) {
    const url = new URL(config.apiBaseUrl, window.location.origin);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/comments`;
    url.search = '';
    url.hash = '';
    url.searchParams.set('post', String(config.targetPublicId));
    if (page !== undefined) {
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(config.perPage));
      url.searchParams.set('order', config.order);
      url.searchParams.set('orderby', 'date_gmt');
    }
    return url.href;
  }

  async function request(url, options = {}) {
    const submitting = options.method === 'POST';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      return { response, payload };
    } catch {
      throw new CommentDataError(submitting
        ? 'The comment could not be confirmed. Check the original WordPress page before trying again.'
        : 'Cannot reach WordPress comments. Try again or open the original WordPress page.');
    } finally {
      clearTimeout(timeout);
    }
  }

  function failure(response, payload, submitting = false) {
    if (response.status === 401 || response.status === 403) {
      return new CommentDataError(submitting
        ? 'WordPress does not allow comments from this site. You can comment on the original WordPress page.'
        : 'WordPress is not allowing this site to read comments. Open the original WordPress page.');
    }
    if (response.status === 429) {
      return new CommentDataError('WordPress is receiving too many requests. Please try again later.');
    }
    const message = typeof payload?.message === 'string' ? plainText(payload.message).slice(0, 400) : '';
    return new CommentDataError(message || (submitting
      ? 'WordPress could not confirm your comment. Check the original page before trying again.'
      : 'Comments are temporarily unavailable. Please try again.'));
  }

  function normalize(comment) {
    if (!Number.isSafeInteger(comment?.id) || comment.id <= 0 || typeof comment.content?.rendered !== 'string') {
      throw new CommentDataError('WordPress returned an unreadable comment. Please try again.');
    }
    const date = typeof comment.date_gmt === 'string' && comment.date_gmt
      ? comment.date_gmt.replace(/Z?$/, 'Z') : String(comment.date || '');
    return {
      id: String(comment.id),
      parentId: Number.isSafeInteger(comment.parent) && comment.parent > 0 ? String(comment.parent) : '',
      authorName: plainText(comment.author_name),
      authorKind: 'guest',
      createdAt: date,
      contentText: plainText(comment.content.rendered),
    };
  }

  function headerInteger(headers, name) {
    const value = headers.get(name);
    return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  }

  class WordPressCommentData {
    constructor(config) {
      const url = new URL(config.apiBaseUrl, window.location.origin);
      if (config.provider !== 'wordpress' || !['http:', 'https:'].includes(url.protocol)
        || url.username || url.password || url.search || url.hash
        || !Number.isSafeInteger(config.targetPublicId) || config.targetPublicId <= 0) {
        throw new CommentDataError('The WordPress comment connection is invalid.');
      }
      this.config = {
        ...config,
        apiBaseUrl: url.href.replace(/\/$/, ''),
        perPage: Math.min(100, Math.max(1, Number.parseInt(config.perPage, 10) || 50)),
        order: config.order === 'asc' ? 'asc' : 'desc',
      };
      this.originalUrl = originalPostUrl(this.config);
    }

    async load(page = 1) {
      const { response, payload } = await request(endpoint(this.config, page));
      // A server that omits pagination headers may reject the page after the last full page.
      if (page > 1 && response.status === 400 && payload?.code === 'rest_comment_invalid_page_number') {
        return { comments: [], pagination: { currentPage: page, totalPages: page } };
      }
      if (!response.ok || !Array.isArray(payload)) throw failure(response, payload);
      const total = headerInteger(response.headers, 'X-WP-Total');
      const pages = headerInteger(response.headers, 'X-WP-TotalPages');
      return {
        comments: payload.map(normalize),
        pagination: {
          currentPage: page,
          totalPages: pages ?? (payload.length === this.config.perPage ? page + 1 : page),
          ...(total === null ? {} : { totalComments: total }),
        },
      };
    }

    async submit(input) {
      const body = new FormData();
      body.set('author_name', input.authorName);
      body.set('author_email', input.authorEmail);
      body.set('content', input.content);
      if (input.parentId) body.set('parent', input.parentId);
      const { response, payload } = await request(endpoint(this.config), { method: 'POST', body });
      if (!response.ok || !Number.isSafeInteger(payload?.id) || payload.id <= 0
        || Number(payload.post) !== this.config.targetPublicId) {
        throw failure(response, payload, true);
      }
      return { publication: payload.status === 'approved' ? 'published' : 'pending_moderation' };
    }
  }

  window.ZeroPressCommentData = {
    create: (config) => new WordPressCommentData(config),
    getErrorMessages: (error) => error instanceof CommentDataError
      ? error.messages : ['Comments are temporarily unavailable. Please try again.'],
  };
})();
