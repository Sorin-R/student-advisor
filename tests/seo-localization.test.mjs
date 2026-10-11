import test from 'node:test'
import assert from 'node:assert/strict'
import { localeAlternates, localeFromPath, localizedPath, stripLocale } from '../src/locale-routes.js'
import { blogArticles, organization, SITE_URL, SOCIAL_IMAGE } from '../src/content-catalog.js'

test('localized routes are permanent, reciprocal and stable across language changes', () => {
  assert.equal(localeFromPath('/ro/study-in-uk'), 'ro')
  assert.equal(stripLocale('/en/blog/guide/'), '/blog/guide/')
  assert.equal(localizedPath('/ro/blog/guide/', 'en'), '/en/blog/guide')
  assert.deepEqual(localeAlternates('/student-visa-costs'), {
    en: '/en/student-visa-costs',
    ro: '/ro/student-visa-costs',
  })
})

test('the shared SEO catalogue exposes verifiable organization and social metadata', () => {
  assert.equal(organization.url, SITE_URL)
  assert.equal(organization.logo.startsWith(`${SITE_URL}/`), true)
  assert.equal(SOCIAL_IMAGE.startsWith(`${SITE_URL}/`), true)
  assert.equal(new Set(blogArticles.map(article => article.slug)).size, blogArticles.length)
})
