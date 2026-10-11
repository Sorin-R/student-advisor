import test from 'node:test'
import assert from 'node:assert/strict'
import { contentPage, canManageContent, editorUrl } from '../src/site-pages.js'
test('page content follows the requested page, not the signed-in student', () => {
 const student = {role:'student'}
 assert.equal(contentPage('/', '', student).key, 'home')
 assert.equal(contentPage('/', '?apply=1', student).key, 'student-account')
 assert.equal(contentPage('/', '?auth=1', student).key, 'sign-in')
 assert.equal(contentPage('/', '?apply=1').key, 'sign-in')
})
test('dynamic pages stay separate and recovery secrets never enter content keys', () => {
 assert.notEqual(contentPage('/blog/one').key, contentPage('/blog/two').key)
 assert.equal(contentPage('/reset-password/SECRET', '?token=SECRET').key, 'reset-password')
 assert.equal(contentPage('/verify-email/SECRET').key, 'verify-email')
 assert.match(contentPage('/future-page').key, /^page\./)
 assert.equal(contentPage('/future-page/').key, contentPage('/future-page').key)
})
test('edit URLs preserve route parameters and reject external destinations', () => {
 assert.equal(editorUrl('/?apply=1', true), '/?apply=1&edit=1')
 assert.equal(editorUrl('/terms?edit=1#content', false), '/terms#content')
 assert.equal(editorUrl('https://external.example/', true), null)
 assert.equal(editorUrl('//external.example/', true), null)
})
test('content editing is restricted to authorized staff', () => {
 assert.equal(canManageContent({role:'admin'}), true)
 assert.equal(canManageContent({role:'moderator',permissions:{manageContent:true}}), true)
 for (const user of [null,{role:'student'},{role:'advisor'},{role:'moderator',permissions:{viewOnly:true}}]) assert.equal(canManageContent(user), false)
})
