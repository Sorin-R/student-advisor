import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blogArticles, CONTENT_REVIEWED, CONTENT_REVIEWED_LABEL, officialSources, organization, SITE_NAME, SITE_URL, SOCIAL_IMAGE } from '../src/content-catalog.js'
import { localizedPath } from '../src/locale-routes.js'
import { universities, universitySlug } from '../src/universities.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const template = await fs.readFile(path.join(dist, 'index.html'), 'utf8')
const translations = Object.fromEntries(await Promise.all(['en', 'ro'].map(async locale => [locale, JSON.parse(await fs.readFile(path.join(root, 'public', 'locales', locale, 'translation.json'), 'utf8'))])))
const routes = []

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const cleanText = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const absolute = route => `${SITE_URL}${route}`
const alternates = pathname => ({ en: absolute(localizedPath(pathname, 'en')), ro: absolute(localizedPath(pathname, 'ro')), default: absolute(localizedPath(pathname, 'en')) })
const jsonLd = value => `<script type="application/ld+json">${JSON.stringify(value).replaceAll('<', '\\u003c')}</script>`
const links = (pathname, locale) => {
  const items = translations[locale].navigation
  return `<nav aria-label="${escapeHtml(items.aria)}"><a href="${localizedPath('/', locale)}">${SITE_NAME}</a><a href="${localizedPath('/free-student-advisory', locale)}">${escapeHtml(items.freeAdvisory)}</a><a href="${localizedPath('/study-in-uk', locale)}">${escapeHtml(items.studyUk)}</a><a href="${localizedPath('/university-admission', locale)}">${escapeHtml(items.admission)}</a><a href="${localizedPath('/blog', locale)}">${escapeHtml(items.blog)}</a><a href="${localizedPath(pathname, locale === 'en' ? 'ro' : 'en')}">${locale === 'en' ? 'Română' : 'English'}</a></nav>`
}

function schemas({ pathname, locale, title, description, type, faq }) {
  const canonical = absolute(localizedPath(pathname, locale))
  const values = [
    organization,
    { '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: SITE_NAME, url: SITE_URL, inLanguage: ['en', 'ro'], publisher: { '@id': `${SITE_URL}/#organization` } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: SITE_NAME, item: absolute(localizedPath('/', locale)) }, ...(pathname === '/' ? [] : [{ '@type': 'ListItem', position: 2, name: title, item: canonical }])] },
  ]
  if (type === 'article') values.push({ '@context': 'https://schema.org', '@type': 'Article', headline: title, description, inLanguage: locale, datePublished: CONTENT_REVIEWED, dateModified: CONTENT_REVIEWED, mainEntityOfPage: canonical, image: SOCIAL_IMAGE, author: { '@id': `${SITE_URL}/#organization`, name: SITE_NAME }, publisher: { '@id': `${SITE_URL}/#organization`, name: SITE_NAME, logo: { '@type': 'ImageObject', url: organization.logo } }, citation: officialSources.map(([, url]) => url) })
  if (type === 'university') values.push({ '@context': 'https://schema.org', '@type': 'CollegeOrUniversity', name: title, description, url: canonical })
  if (faq?.length) values.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: cleanText(`${item.answer} ${item.suffix || ''}`) } })) })
  return values.map(jsonLd).join('')
}

function renderDocument({ pathname, locale, title, description, body, type = 'article', faq = null }) {
  const canonical = absolute(localizedPath(pathname, locale))
  const alternate = alternates(pathname)
  const head = `<link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="en" href="${alternate.en}"><link rel="alternate" hreflang="ro" href="${alternate.ro}"><link rel="alternate" hreflang="x-default" href="${alternate.default}"><meta property="og:type" content="${type === 'article' ? 'article' : 'website'}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${SOCIAL_IMAGE}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${SOCIAL_IMAGE}">${schemas({ pathname, locale, title, description, type, faq })}`
  return template
    .replace('<html lang="en">', `<html lang="${locale}">`)
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace('</head>', `${head}</head>`)
    .replace('<div id="root"></div>', `<div id="root"><div class="site-shell content-page seo-prerender">${links(pathname, locale)}<main><article class="content-article">${body}</article></main><footer><a href="${localizedPath('/', locale)}">${SITE_NAME}</a><span>© 2026 Student Advisor</span></footer></div></div>`)
}

function homeBody(locale, content) {
  const marketing = content.marketing
  const faq = content.pages.home.faq
  return `<header class="content-hero"><p class="eyebrow">${escapeHtml(marketing.hero.eyebrow)}</p><h1>${escapeHtml(marketing.hero.title)}</h1><p>${escapeHtml(marketing.hero.intro)}</p><p class="content-reviewer">${escapeHtml(CONTENT_REVIEWED_LABEL[locale])}</p></header><section><h2>${escapeHtml(marketing.intro.title)}</h2><p>${escapeHtml(marketing.intro.copy)}</p></section><section><h2>${escapeHtml(marketing.pathway.title)}</h2><p>${escapeHtml(marketing.pathway.caption)}</p><ol>${marketing.pathway.steps.map(step => `<li><strong>${escapeHtml(step.title)}</strong> ${escapeHtml(step.copy)}</li>`).join('')}</ol></section><section><h2>${escapeHtml(faq.title)}</h2>${faq.items.map(item => `<article><h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(cleanText(`${item.answer} ${item.suffix || ''}`))}</p></article>`).join('')}</section>`
}

function editorialBody(locale, page) {
  return `<header class="content-hero"><p class="eyebrow">${escapeHtml(page.eyebrow)}</p><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.dek)}</p><p class="content-reviewer">${escapeHtml(CONTENT_REVIEWED_LABEL[locale])} · ${locale === 'ro' ? 'Verificat de echipa editorială Student Advisor' : 'Checked by the Student Advisor editorial team'}</p></header>${page.sections.map((section, index) => `<section><p class="content-section-number">${String(index + 1).padStart(2, '0')}</p><div><h2>${escapeHtml(section.heading)}</h2><p class="direct-answer">${escapeHtml(section.answer)}</p>${section.paragraph ? `<p>${escapeHtml(section.paragraph)}</p>` : ''}${section.items ? `<${section.listType === 'ordered' ? 'ol' : 'ul'}>${section.items.map(item => `<li><strong>${escapeHtml(item.title)}</strong> ${escapeHtml(item.text)}</li>`).join('')}</${section.listType === 'ordered' ? 'ol' : 'ul'}>` : ''}${section.table ? `<table><thead><tr>${section.table.headers.map(value => `<th>${escapeHtml(value)}</th>`).join('')}</tr></thead><tbody>${section.table.rows.map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}${section.source ? `<p><a href="${escapeHtml(section.source.url)}">${escapeHtml(section.source.label)}</a></p>` : ''}</div></section>`).join('')}`
}

for (const locale of ['en', 'ro']) {
  const content = translations[locale]
  const home = content.pages.home
  routes.push({ pathname: '/', locale, title: home.seo.title, description: home.seo.description, type: 'website', faq: home.faq.items, body: homeBody(locale, content) })
  for (const [pageKey, page] of Object.entries(content.pages)) {
    if (pageKey === 'home' || !page?.seo || !Array.isArray(page.sections)) continue
    routes.push({ pathname: `/${pageKey}`, locale, title: page.seo.title, description: page.seo.description, type: 'article', body: editorialBody(locale, page) })
  }
  const blogTitle = locale === 'ro' ? 'Blog studii în UK pentru rezidenți români | Student Advisor' : 'UK Study Blog for Romanian residents | Student Advisor'
  const blogDescription = locale === 'ro' ? 'Ghiduri clare pentru rezidenții români din Anglia despre admitere, Student Finance, cursuri flexibile și studii în UK.' : 'Clear guides for Romanian residents in England about admissions, Student Finance, flexible study and university life.'
  routes.push({ pathname: '/blog', locale, title: blogTitle, description: blogDescription, type: 'website', body: `<header class="content-hero"><h1>${escapeHtml(blogTitle)}</h1><p>${escapeHtml(blogDescription)}</p></header><section><h2>${locale === 'ro' ? 'Toate ghidurile' : 'All guides'}</h2>${blogArticles.map(article => `<article><h3><a href="${localizedPath(`/blog/${article.slug}`, locale)}">${escapeHtml(locale === 'ro' ? article.titleRo : article.titleEn)}</a></h3><p>${escapeHtml(locale === 'ro' ? article.focusRo : article.focusEn)}</p></article>`).join('')}</section>` })
  for (const article of blogArticles) {
    const title = `${locale === 'ro' ? article.titleRo : article.titleEn} | Student Advisor`
    const description = locale === 'ro' ? `Ghid Student Advisor pentru ${article.keyword}: verificări, pași practici și surse oficiale pentru studii în UK.` : `A clear Student Advisor guide to ${article.keyword}: practical checks, application steps and official UK study-funding sources.`
    const answer = locale === 'ro' ? `${article.keyword} necesită verificarea situației personale, a cursului și a regulilor oficiale aplicabile. Student Advisor te ajută să organizezi pașii, însă universitatea și Student Finance England iau deciziile finale.` : `${article.keyword} requires checks against your personal circumstances, course and the current official rules. Student Advisor can help organise the steps, while the university and Student Finance England make the final decisions.`
    const sourceList = officialSources.map(([label, url]) => `<li><a href="${url}">${escapeHtml(label)}</a></li>`).join('')
    routes.push({ pathname: `/blog/${article.slug}`, locale, title, description, type: 'article', body: `<header class="content-hero"><p class="eyebrow">${locale === 'ro' ? 'Ghid pentru studii în UK' : 'UK study guide'}</p><h1>${escapeHtml(locale === 'ro' ? article.titleRo : article.titleEn)}</h1><p>${escapeHtml(description)}</p><p class="content-reviewer">${escapeHtml(CONTENT_REVIEWED_LABEL[locale])}</p></header><section><h2>${locale === 'ro' ? 'Răspunsul direct' : 'Direct answer'}</h2><p class="direct-answer">${escapeHtml(answer)}</p></section><section><h2>${locale === 'ro' ? 'Ce trebuie să verifici' : 'What to check'}</h2><p>${escapeHtml(locale === 'ro' ? article.focusRo : article.focusEn)}. ${locale === 'ro' ? 'Confirmă eligibilitatea, termenele, costurile și documentele direct cu instituția relevantă.' : 'Confirm eligibility, deadlines, costs and documents directly with the relevant institution.'}</p></section><section><h2>${locale === 'ro' ? 'Surse oficiale' : 'Official sources'}</h2><ul>${sourceList}</ul></section>` })
  }
  for (const university of universities) {
    const description = content.marketing.universityDescriptions?.[universitySlug(university.name)] || university.description
    routes.push({ pathname: `/universities/${universitySlug(university.name)}`, locale, title: `${university.name} | Student Advisor`, description, type: 'university', body: `<header class="content-hero"><p class="eyebrow">${escapeHtml(content.marketing.university.profile)}</p><h1>${escapeHtml(university.name)}</h1><p>${escapeHtml(description)}</p><p class="content-reviewer">${escapeHtml(CONTENT_REVIEWED_LABEL[locale])}</p></header><section><h2>${escapeHtml(content.marketing.university.locations)}</h2><ul>${university.campuses.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section><section><h2>${escapeHtml(content.marketing.university.courses)}</h2><ul>${university.courses.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` })
  }
}

const manifest = {}
for (const route of routes) {
  const publicPath = localizedPath(route.pathname, route.locale).replace(/\/$/, '') || `/${route.locale}`
  const relative = path.posix.join('_seo', publicPath.replace(/^\//, '') || route.locale, 'index.html')
  await fs.mkdir(path.join(dist, path.dirname(relative)), { recursive: true })
  await fs.writeFile(path.join(dist, relative), renderDocument(route))
  manifest[publicPath] = relative
  if (route.pathname === '/') manifest[`${publicPath}/`] = relative
  // Keep legacy, unprefixed public URLs crawlable while the canonical route
  // remains the explicit English locale. Client-side language detection can
  // still replace this initial document for returning Romanian visitors.
  if (route.locale === 'en') {
    const legacyPath = route.pathname === '/' ? '/' : route.pathname.replace(/\/$/, '')
    manifest[legacyPath] = relative
    if (route.pathname === '/') manifest[''] = relative
  }
}
await fs.writeFile(path.join(dist, 'seo-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const uniquePaths = [...new Set(routes.map(route => route.pathname))]
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${uniquePaths.map(pathname => ['en', 'ro'].map(locale => `  <url>\n    <loc>${absolute(localizedPath(pathname, locale))}</loc>\n    <lastmod>${CONTENT_REVIEWED}</lastmod>\n    <xhtml:link rel="alternate" hreflang="en" href="${absolute(localizedPath(pathname, 'en'))}"/>\n    <xhtml:link rel="alternate" hreflang="ro" href="${absolute(localizedPath(pathname, 'ro'))}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${absolute(localizedPath(pathname, 'en'))}"/>\n  </url>`).join('\n')).join('\n')}\n</urlset>\n`
await fs.writeFile(path.join(dist, 'sitemap.xml'), sitemap)

const llms = `# Student Advisor\n\n> Student Advisor provides free, practical English and Romanian guidance for prospective students exploring UK university study and applications.\n\n## Canonical guides\n\n${uniquePaths.filter(value => !value.startsWith('/universities/')).map(pathname => `- [${pathname === '/' ? 'Student Advisor home' : pathname.split('/').at(-1).replaceAll('-', ' ')}](${absolute(localizedPath(pathname, 'en'))})`).join('\n')}\n\n## Editorial standards\n\n- Content identifies its review date and links to official sources for changing rules, fees and deadlines.\n- Admissions and funding decisions belong to universities and the relevant public authority.\n- Student accounts, adviser workspaces and admin pages are private and are not public reference material.\n`
await fs.writeFile(path.join(dist, 'llms.txt'), llms)
console.log(`Prerendered ${routes.length} localized public pages and ${uniquePaths.length} sitemap route groups.`)
