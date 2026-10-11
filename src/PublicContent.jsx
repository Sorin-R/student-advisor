import ThemeToggle from './ThemeToggle'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from './i18n'
import { EditableText } from './SiteEditor'

const siteUrl = (import.meta.env.VITE_PUBLIC_URL || window.location.origin).replace(/\/$/, '')
const socialImage = 'https://images.unsplash.com/photo-1564981797816-1043664bf78d?auto=format&fit=crop&w=1200&h=630&q=85'

export function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const next = i18n.resolvedLanguage === 'ro' ? 'en' : 'ro'
  return <button className="language-switcher" type="button" onClick={() => changeLanguage(next)} aria-label={next === 'ro' ? 'Schimbă limba în română' : 'Switch language to English'}>{next.toUpperCase()}</button>
}

export function PublicHeader() {
  const { t } = useTranslation()
  return <header className="header content-header"><Link className="logo" to="/"><span>student</span><strong>advisor</strong><b>®</b></Link><nav aria-label={t('navigation.aria')}><Link to="/free-student-advisory">{t('navigation.freeAdvisory')}</Link><Link to="/study-in-uk">{t('navigation.studyUk')}</Link><Link to="/university-admission">{t('navigation.admission')}</Link><Link to="/blog">{t('navigation.blog')}</Link></nav><div className="content-header-actions"><ThemeToggle /><LanguageSwitcher /><Link className="header-cta" to="/?apply=1">{t('navigation.applyShort')}</Link></div></header>
}

function Seo({ pageKey, type = 'article', faq = null }) {
  const { t, i18n } = useTranslation()
  const path = pageKey === 'home' ? '/' : `/${pageKey}`
  const url = `${siteUrl}${path}`
  const schemas = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Student Advisor', url: siteUrl },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Student Advisor', url: siteUrl, inLanguage: ['en', 'ro'] },
  ]
  if (type === 'article') schemas.push({ '@context': 'https://schema.org', '@type': 'Article', headline: t(`pages.${pageKey}.seo.title`), description: t(`pages.${pageKey}.seo.description`), inLanguage: i18n.resolvedLanguage, mainEntityOfPage: url, author: { '@type': 'Organization', name: 'Student Advisor' }, publisher: { '@type': 'Organization', name: 'Student Advisor' } })
  if (faq) schemas.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.plainAnswer } })) })
  return <Helmet><title>{t(`pages.${pageKey}.seo.title`)}</title><meta name="description" content={t(`pages.${pageKey}.seo.description`)} /><meta property="og:title" content={t(`pages.${pageKey}.seo.title`)} /><meta property="og:description" content={t(`pages.${pageKey}.seo.description`)} /><meta property="og:image" content={socialImage} /><meta property="og:url" content={url} /><meta property="og:type" content={type === 'article' ? 'article' : 'website'} /><link rel="canonical" href={url} /><link rel="alternate" hrefLang="en" href={`${url}?lang=en`} /><link rel="alternate" hrefLang="ro" href={`${url}?lang=ro`} /><link rel="alternate" hrefLang="x-default" href={`${url}?lang=en`} />{schemas.map((schema, index) => <script key={index} type="application/ld+json">{JSON.stringify(schema)}</script>)}</Helmet>
}

export function ContentFooter() {
  const { t } = useTranslation()
  return <footer><Link className="logo" to="/"><span>student</span><strong>advisor</strong><b>®</b></Link><p>{t('footer.tagline')}</p><Link to="/free-student-advisory">{t('navigation.freeAdvisory')}</Link><Link to="/study-in-uk">{t('navigation.studyUk')}</Link><Link to="/university-admission">{t('navigation.admission')}</Link><Link to="/terms">{t('marketing.footer.terms')}</Link><Link to="/privacy">Privacy notice</Link><span>© 2026 Student Advisor</span></footer>
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
  const { t } = useTranslation()
  const sections = t(`pages.${pageKey}.sections`, { returnObjects: true })
  const links = pageLinks[pageKey]
  return <><div className="site-shell content-page"><Seo pageKey={pageKey} /><PublicHeader /><main><article className="content-article"><header className="content-hero"><p className="eyebrow"><EditableText field="hero.eyebrow" label="Page eyebrow">{t(`pages.${pageKey}.eyebrow`)}</EditableText></p><h1><EditableText field="hero.title" label="Page heading">{t(`pages.${pageKey}.title`)}</EditableText></h1><p><EditableText field="hero.dek" label="Page introduction">{t(`pages.${pageKey}.dek`)}</EditableText></p></header>{sections.map((section, index) => <section key={section.heading} id={`section-${index + 1}`}><p className="content-section-number">0{index + 1}</p><div><h2><EditableText field={`section${index + 1}.heading`} label={`Section ${index + 1} heading`}>{section.heading}</EditableText></h2><p className="direct-answer"><EditableText field={`section${index + 1}.answer`} label={`Section ${index + 1} answer`}>{section.answer}</EditableText></p>{section.paragraph && <p><EditableText field={`section${index + 1}.paragraph`} label={`Section ${index + 1} paragraph`}>{section.paragraph}</EditableText></p>}{section.listType === 'ordered' && <ol>{section.items.map((item, itemIndex) => <li key={item.title}><strong><EditableText field={`section${index + 1}.item${itemIndex + 1}.title`} label={`Section ${index + 1}, item ${itemIndex + 1} heading`}>{item.title}</EditableText></strong><span><EditableText field={`section${index + 1}.item${itemIndex + 1}.text`} label={`Section ${index + 1}, item ${itemIndex + 1} text`}>{item.text}</EditableText></span>{item.link === 'admission' && <Link to="/university-admission">{t('navigation.admission')} →</Link>}</li>)}</ol>}{section.listType === 'unordered' && <ul>{section.items.map((item, itemIndex) => <li key={item.title}><strong><EditableText field={`section${index + 1}.item${itemIndex + 1}.title`} label={`Section ${index + 1}, item ${itemIndex + 1} heading`}>{item.title}</EditableText></strong><span><EditableText field={`section${index + 1}.item${itemIndex + 1}.text`} label={`Section ${index + 1}, item ${itemIndex + 1} text`}>{item.text}</EditableText></span></li>)}</ul>}{section.table && <div className="content-table-wrap"><table><thead><tr>{section.table.headers.map((header, columnIndex) => <th key={header}><EditableText field={`section${index + 1}.table.header${columnIndex + 1}`} label={`Section ${index + 1}, table header ${columnIndex + 1}`}>{header}</EditableText></th>)}</tr></thead><tbody>{section.table.rows.map((row, rowIndex) => <tr key={row[0]}>{row.map((cell, columnIndex) => <td key={`${rowIndex}-${columnIndex}`}><EditableText field={`section${index + 1}.table.row${rowIndex + 1}.cell${columnIndex + 1}`} label={`Section ${index + 1}, table row ${rowIndex + 1}, cell ${columnIndex + 1}`}>{cell}</EditableText></td>)}</tr>)}</tbody></table></div>}{section.source && <p className="source-link"><a href={section.source.url} target="_blank" rel="noreferrer">{section.source.label} ↗</a></p>}{links[index] && <p className="related-link"><SectionLink link={links[index]} /></p>}</div></section>)}</article></main><ContentFooter /></div></>
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
