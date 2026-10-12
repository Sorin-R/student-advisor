import { adminRequired } from './security.js'

const EVENT_TYPES = new Set(['page_view', 'section_view', 'action_click', 'form_start', 'form_submit', 'action_success', 'action_failure', 'page_time', 'section_time', 'course_search'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const handler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(error => {
  if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error.code)) return res.status(503).json({ error: 'Website analytics setup is pending. Run the included analytics database migration, then try again.' })
  next(error)
})
let lastRetentionRun = 0
const labelValue = value => typeof value === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} :_./'’&()!?,-]{0,119}$/u.test(value) ? value : null
function safePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/unknown'
  let path = value.split(/[?#]/, 1)[0].slice(0, 180).replace(/\/{2,}/g, '/')
  path = path.replace(/\/(verify-email|reset-password)\/[^/]+/gi, '/$1/:token')
  path = path.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id').replace(/\/\d{3,}/g, '/:id')
  return path || '/'
}

export function registerAnalyticsRoutes(app, { pool }) {
  app.post('/api/analytics/events', handler(async (req, res) => {
    const events = req.body?.events
    if (!Array.isArray(events) || events.length < 1 || events.length > 40) return res.status(400).json({ error: 'Send between 1 and 40 analytics events.' })
    const rows = []
    for (const event of events) {
      if (!event || !EVENT_TYPES.has(event.type) || !UUID.test(event.visitorId || '') || !UUID.test(event.sessionId || '')) continue
      const path = safePath(event.path)
      if (/^\/(admin|advisor)(?:\/|$)/.test(path)) continue
      const duration = ['page_time', 'section_time'].includes(event.type) ? Math.max(0, Math.min(3600, Math.floor(Number(event.durationSeconds) || 0))) : null
      rows.push([event.visitorId, event.sessionId, event.type, path, labelValue(event.target), labelValue(event.section), duration])
    }
    if (!rows.length) return res.status(400).json({ error: 'No valid analytics events were provided.' })
    if (Date.now() - lastRetentionRun > 86_400_000) {
      lastRetentionRun = Date.now()
      await pool.query('DELETE FROM analytics_events WHERE occurred_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY) LIMIT 20000')
    }
    await pool.query('INSERT INTO analytics_events (visitor_id, session_id, event_type, page_path, target, section_id, duration_seconds) VALUES ?', [rows])
    res.status(202).json({ accepted: rows.length })
  }))

  app.get('/api/admin/metrics', adminRequired, handler(async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30
    const since = new Date(Date.now() - days * 86400_000)
    const [[overview]] = await pool.execute(`SELECT COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT visitor_id) AS visitors,
      SUM(event_type = 'page_view') AS pageViews, SUM(event_type = 'action_click' AND target NOT IN ('button', 'link')) AS actionClicks,
      SUM(event_type = 'course_search') AS courseSearches,
      SUM(event_type = 'form_start') AS formStarts, SUM(event_type = 'form_submit') AS formSubmits,
      SUM(event_type = 'action_success') AS actionSuccesses, SUM(event_type = 'action_failure') AS actionFailures,
      SUM(CASE WHEN event_type = 'page_time' THEN duration_seconds ELSE 0 END) AS totalSeconds
      FROM analytics_events WHERE occurred_at >= ? AND page_path NOT LIKE '/admin%' AND page_path NOT LIKE '/advisor%'`, [since])
    const [[average]] = await pool.execute(`SELECT AVG(session_seconds) AS averageSessionSeconds FROM (
      SELECT visitor_id, session_id, SUM(duration_seconds) AS session_seconds FROM analytics_events
      WHERE occurred_at >= ? AND event_type = 'page_time' AND page_path NOT LIKE '/admin%' AND page_path NOT LIKE '/advisor%' GROUP BY visitor_id, session_id
    ) AS session_times`, [since])
    const [topPages] = await pool.execute(`SELECT p.page_path AS path, p.views, p.visitors, COALESCE(t.seconds, 0) AS seconds,
      ROUND(COALESCE(t.seconds, 0) / NULLIF(p.views, 0)) AS averageSeconds FROM
      (SELECT page_path, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors FROM analytics_events
       WHERE occurred_at >= ? AND event_type = 'page_view' AND page_path NOT LIKE '/admin%' AND page_path NOT LIKE '/advisor%' GROUP BY page_path) p
      LEFT JOIN (SELECT page_path, SUM(duration_seconds) AS seconds FROM analytics_events
       WHERE occurred_at >= ? AND event_type = 'page_time' AND page_path NOT LIKE '/admin%' AND page_path NOT LIKE '/advisor%' GROUP BY page_path) t ON t.page_path = p.page_path
      ORDER BY p.views DESC`, [since, since])
    const [topSections] = await pool.execute(`SELECT v.page_path AS page, v.section_id AS section, v.views,
      ROUND(COALESCE(t.seconds, 0) / NULLIF(v.views, 0)) AS averageSeconds FROM
      (SELECT page_path, section_id, COUNT(*) AS views FROM analytics_events WHERE occurred_at >= ? AND event_type = 'section_view' AND section_id IS NOT NULL AND page_path NOT LIKE '/admin%' AND page_path NOT LIKE '/advisor%' GROUP BY page_path, section_id) v
      LEFT JOIN (SELECT page_path, section_id, SUM(duration_seconds) AS seconds FROM analytics_events WHERE occurred_at >= ? AND event_type = 'section_time' AND section_id IS NOT NULL AND page_path NOT LIKE '/admin%' AND page_path NOT LIKE '/advisor%' GROUP BY page_path, section_id) t
      ON t.page_path = v.page_path AND t.section_id = v.section_id ORDER BY v.views DESC`, [since, since])
    const [actions] = await pool.execute(`SELECT target AS action, page_path AS page, section_id AS section,
      SUM(event_type = 'action_click') AS clicks, SUM(event_type = 'form_submit') AS attempts, SUM(event_type = 'action_success') AS successes,
      SUM(event_type = 'action_failure') AS failures FROM analytics_events
      WHERE occurred_at >= ? AND event_type IN ('action_click','form_submit','action_success','action_failure') AND target IS NOT NULL AND target NOT IN ('button', 'link') AND target NOT LIKE 'university:%' AND page_path NOT LIKE '/admin%' AND page_path NOT LIKE '/advisor%'
      GROUP BY target, page_path, section_id ORDER BY clicks DESC, attempts DESC`, [since])
    const [universities] = await pool.execute(`SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(target, ':', 2), ':', -1) AS university,
      COUNT(*) AS clicks, COUNT(DISTINCT visitor_id) AS visitors FROM analytics_events
      WHERE occurred_at >= ? AND event_type = 'action_click' AND target LIKE 'university:%'
      AND page_path NOT LIKE '/admin%' AND page_path NOT LIKE '/advisor%'
      GROUP BY university ORDER BY clicks DESC, visitors DESC`, [since])
    const [courseSearches] = await pool.execute(`SELECT target AS term, COUNT(*) AS searches, COUNT(DISTINCT visitor_id) AS visitors
      FROM analytics_events WHERE occurred_at >= ? AND event_type = 'course_search' AND target IS NOT NULL
      AND page_path NOT LIKE '/admin%' AND page_path NOT LIKE '/advisor%'
      GROUP BY target ORDER BY searches DESC, visitors DESC`, [since])
    const [daily] = await pool.execute(`SELECT DATE(occurred_at) AS day,
      SUM(event_type = 'page_view') AS pageViews, COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN session_id END) AS sessions,
      SUM(event_type = 'action_click' AND target NOT IN ('button', 'link')) AS actionClicks FROM analytics_events
      WHERE occurred_at >= ? AND page_path NOT LIKE '/admin%' AND page_path NOT LIKE '/advisor%' GROUP BY DATE(occurred_at) ORDER BY day`, [since])
    res.set('Cache-Control', 'no-store').json({ days, overview: {
      sessions: Number(overview.sessions || 0), visitors: Number(overview.visitors || 0), pageViews: Number(overview.pageViews || 0),
      actionClicks: Number(overview.actionClicks || 0), courseSearches: Number(overview.courseSearches || 0), formStarts: Number(overview.formStarts || 0), formSubmits: Number(overview.formSubmits || 0),
      actionSuccesses: Number(overview.actionSuccesses || 0), actionFailures: Number(overview.actionFailures || 0),
      totalSeconds: Number(overview.totalSeconds || 0), averageSessionSeconds: Math.round(Number(average.averageSessionSeconds || 0)),
    }, topPages, topSections, actions, universities, courseSearches, daily })
  }))
}
