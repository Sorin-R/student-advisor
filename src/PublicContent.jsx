import ThemeToggle from './ThemeToggle'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from './i18n'
import { EditableText } from './SiteEditor'
import { CONTENT_REVIEWED, CONTENT_REVIEWED_LABEL, organization, SITE_NAME, SITE_URL, SOCIAL_IMAGE } from './content-catalog'
import { localizedPath } from './locale-routes'

const siteUrl = (import.meta.env.VITE_PUBLIC_URL || SITE_URL).replace(/\/$/, '')

export function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const next = i18n.resolvedLanguage === 'ro' ? 'en' : 'ro'
  return <button className="language-switcher" type="button" onClick={() => changeLanguage(next)} aria-label={next === 'ro' ? 'Schimbă limba în română' : 'Switch language to English'}>{next.toUpperCase()}</button>
}

export function PublicHeader() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage?.startsWith('ro') ? 'ro' : 'en'
  return <header className="header content-header"><Link className="logo" to={localizedPath('/', locale)}><span>student</span><strong>advisor</strong><b>®</b></Link><nav aria-label={t('navigation.aria')}><Link to={localizedPath('/free-student-advisory', locale)}>{t('navigation.freeAdvisory')}</Link><Link to={localizedPath('/study-in-uk', locale)}>{t('navigation.studyUk')}</Link><Link to={localizedPath('/university-admission', locale)}>{t('navigation.admission')}</Link><Link to={localizedPath('/blog', locale)}>{t('navigation.blog')}</Link></nav><div className="content-header-actions"><ThemeToggle /><LanguageSwitcher /><Link className="header-cta" to="/?apply=1">{t('navigation.applyShort')}</Link></div></header>
}

function Seo({ pageKey, type = 'article', faq = null }) {
  const { t, i18n } = useTranslation()
  const path = pageKey === 'home' ? '/' : `/${pageKey}`
  const locale = i18n.resolvedLanguage?.startsWith('ro') ? 'ro' : 'en'
  const url = `${siteUrl}${localizedPath(path, locale)}`
  const title = t(`pages.${pageKey}.seo.title`)
  const description = t(`pages.${pageKey}.seo.description`)
  const schemas = [
    organization,
    { '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${siteUrl}/#website`, name: SITE_NAME, url: siteUrl, inLanguage: ['en', 'ro'], publisher: { '@id': `${siteUrl}/#organization` } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${siteUrl}${localizedPath('/', locale)}` }, ...(path === '/' ? [] : [{ '@type': 'ListItem', position: 2, name: title, item: url }])] },
  ]
  if (type === 'article') schemas.push({ '@context': 'https://schema.org', '@type': 'Article', headline: title, description, inLanguage: locale, datePublished: CONTENT_REVIEWED, dateModified: CONTENT_REVIEWED, mainEntityOfPage: url, author: { '@id': `${siteUrl}/#organization`, name: SITE_NAME }, publisher: { '@id': `${siteUrl}/#organization`, name: SITE_NAME, logo: { '@type': 'ImageObject', url: organization.logo } }, image: SOCIAL_IMAGE })
  if (faq) schemas.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.plainAnswer } })) })
  return <Helmet><html lang={locale} /><title>{title}</title><meta name="description" content={description} /><meta property="og:title" content={title} /><meta property="og:description" content={description} /><meta property="og:image" content={SOCIAL_IMAGE} /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta property="og:url" content={url} /><meta property="og:locale" content={locale === 'ro' ? 'ro_RO' : 'en_GB'} /><meta property="og:type" content={type === 'article' ? 'article' : 'website'} /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content={title} /><meta name="twitter:description" content={description} /><meta name="twitter:image" content={SOCIAL_IMAGE} /><link rel="canonical" href={url} /><link rel="alternate" hrefLang="en" href={`${siteUrl}${localizedPath(path, 'en')}`} /><link rel="alternate" hrefLang="ro" href={`${siteUrl}${localizedPath(path, 'ro')}`} /><link rel="alternate" hrefLang="x-default" href={`${siteUrl}${localizedPath(path, 'en')}`} />{schemas.map((schema, index) => <script key={index} type="application/ld+json">{JSON.stringify(schema)}</script>)}</Helmet>
}

export function ContentFooter() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage?.startsWith('ro') ? 'ro' : 'en'
  return <footer><Link className="logo" to={localizedPath('/', locale)}><span>student</span><strong>advisor</strong><b>®</b></Link><p>{t('footer.tagline')}</p><Link to={localizedPath('/free-student-advisory', locale)}>{t('navigation.freeAdvisory')}</Link><Link to={localizedPath('/study-in-uk', locale)}>{t('navigation.studyUk')}</Link><Link to={localizedPath('/university-admission', locale)}>{t('navigation.admission')}</Link><Link to={localizedPath('/student-visa-costs', locale)}>{locale === 'ro' ? 'Costuri viză Student' : 'Student visa costs'}</Link><Link to={localizedPath('/editorial-policy', locale)}>{locale === 'ro' ? 'Politica editorială' : 'Editorial policy'}</Link><Link to="/terms">{t('marketing.footer.terms')}</Link><Link to="/privacy">Privacy notice</Link><span>© 2026 Student Advisor</span></footer>
}

const pageLinks = {
  'free-student-advisory': [
    { href: '/#faq', key: 'homepageFaq' },
    { href: '/university-admission', key: 'admission' },
    { href: '/study-in-uk', key: 'studyUk' },
  ],
  'study-in-uk': [
    null,
    { href: '/free-student-advisory', key: 'freeAdvisory' },
    { href: '/university-admission', key: 'admission' },
  ],
  'university-admission': [
    null,
    { href: '/free-student-advisory', key: 'freeAdvisory' },
    { href: '/study-in-uk', key: 'studyUk' },
  ],
}

function SectionLink({ link }) {
  const { t } = useTranslation()
  return <Link to={link.href}>{t(`navigation.${link.key}`)} →</Link>
}

export function EditorialPage({ pageKey }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage?.startsWith('ro') ? 'ro' : 'en'
  const sections = t(`pages.${pageKey}.sections`, { returnObjects: true })
  const links = pageLinks[pageKey]
  return <><div className="site-shell content-page"><Seo pageKey={pageKey} /><PublicHeader /><main><article className="content-article"><header className="content-hero"><p className="eyebrow"><EditableText field="hero.eyebrow" label="Page eyebrow">{t(`pages.${pageKey}.eyebrow`)}</EditableText></p><h1><EditableText field="hero.title" label="Page heading">{t(`pages.${pageKey}.title`)}</EditableText></h1><p><EditableText field="hero.dek" label="Page introduction">{t(`pages.${pageKey}.dek`)}</EditableText></p><p className="content-reviewer"><EditableText field="hero.reviewed" label="Page review date">{CONTENT_REVIEWED_LABEL[locale]}</EditableText> · <EditableText field="hero.reviewer" label="Page reviewer">{locale === 'ro' ? 'Verificat de echipa editorială Student Advisor' : 'Checked by the Student Advisor editorial team'}</EditableText></p></header>{sections.map((section, index) => <section key={section.heading} id={`section-${index + 1}`} data-analytics-section={section.heading}><p className="content-section-number">0{index + 1}</p><div><h2><EditableText field={`section${index + 1}.heading`} label={`Section ${index + 1} heading`}>{section.heading}</EditableText></h2><p className="direct-answer"><EditableText field={`section${index + 1}.answer`} label={`Section ${index + 1} answer`}>{section.answer}</EditableText></p>{section.paragraph && <p><EditableText field={`section${index + 1}.paragraph`} label={`Section ${index + 1} paragraph`}>{section.paragraph}</EditableText></p>}{section.listType === 'ordered' && <ol>{section.items.map((item, itemIndex) => <li key={item.title}><strong><EditableText field={`section${index + 1}.item${itemIndex + 1}.title`} label={`Section ${index + 1}, item ${itemIndex + 1} heading`}>{item.title}</EditableText></strong><span><EditableText field={`section${index + 1}.item${itemIndex + 1}.text`} label={`Section ${index + 1}, item ${itemIndex + 1} text`}>{item.text}</EditableText></span>{item.link === 'admission' && <Link to={localizedPath('/university-admission', locale)}>{t('navigation.admission')} →</Link>}</li>)}</ol>}{section.listType === 'unordered' && <ul>{section.items.map((item, itemIndex) => <li key={item.title}><strong><EditableText field={`section${index + 1}.item${itemIndex + 1}.title`} label={`Section ${index + 1}, item ${itemIndex + 1} heading`}>{item.title}</EditableText></strong><span><EditableText field={`section${index + 1}.item${itemIndex + 1}.text`} label={`Section ${index + 1}, item ${itemIndex + 1} text`}>{item.text}</EditableText></span></li>)}</ul>}{section.table && <div className="content-table-wrap"><table><thead><tr>{section.table.headers.map((header, columnIndex) => <th key={header}><EditableText field={`section${index + 1}.table.header${columnIndex + 1}`} label={`Section ${index + 1}, table header ${columnIndex + 1}`}>{header}</EditableText></th>)}</tr></thead><tbody>{section.table.rows.map((row, rowIndex) => <tr key={row[0]}>{row.map((cell, columnIndex) => <td key={`${rowIndex}-${columnIndex}`}><EditableText field={`section${index + 1}.table.row${rowIndex + 1}.cell${columnIndex + 1}`} label={`Section ${index + 1}, table row ${rowIndex + 1}, cell ${columnIndex + 1}`}>{cell}</EditableText></td>)}</tr>)}</tbody></table></div>}{section.source && <p className="source-link"><a href={section.source.url} target="_blank" rel="noreferrer">{section.source.label} ↗</a></p>}{links?.[index] && <p className="related-link"><SectionLink link={{ ...links[index], href: localizedPath(links[index].href, locale) }} /></p>}</div></section>)}</article></main><ContentFooter /></div></>
}

export function HomeFaq() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(0)
  const items = t('pages.home.faq.items', { returnObjects: true })
  const linkMap = ['/free-student-advisory', '/university-admission', '/study-in-uk', null]
  const linkLabels = ['freeAdvisory', 'admission', 'studyUk', null]
  const schemaItems = items.map((item, index) => ({ question: item.question, plainAnswer: `${item.answer}${index < 3 ? ` ${t(`navigation.${linkLabels[index]}`)} ${item.suffix}` : ''}` }))
  return <section className="faq-section" id="faq"><Seo pageKey="home" type="website" faq={schemaItems} /><div className="section-top"><div><p className="eyebrow"><EditableText field="faq.eyebrow" label="FAQ eyebrow">{t('pages.home.faq.eyebrow')}</EditableText></p><h2><EditableText field="faq.title" label="FAQ heading">{t('pages.home.faq.title')}</EditableText></h2></div><p className="section-caption"><EditableText field="faq.intro" label="FAQ introduction">{t('pages.home.faq.intro')}</EditableText></p></div><div className="faq-list">{items.map((item, index) => <article className="faq-item" key={item.question}><h3><button type="button" aria-expanded={open === index} onClick={() => setOpen(open === index ? -1 : index)}><span><EditableText field={`faq.item${index + 1}.question`} label={`FAQ ${index + 1} question`} embedded>{item.question}</EditableText></span><b aria-hidden="true">{open === index ? '−' : '+'}</b></button></h3><div className={open === index ? 'faq-answer open' : 'faq-answer'}><p><EditableText field={`faq.item${index + 1}.answer`} label={`FAQ ${index + 1} answer`}>{item.answer}</EditableText> {linkMap[index] && <><Link to={linkMap[index]}>{t(`navigation.${linkLabels[index]}`)}</Link> {item.suffix}</>}</p></div></article>)}</div></section>
}
